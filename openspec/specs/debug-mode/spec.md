## ADDED Requirements

### Requirement: Debug mode activation via slash command
The system SHALL provide a `/debug` slash command that toggles the session into Debug mode. Invoking `/debug` while Debug mode is already active SHALL disable Debug mode and restore the previous model and thinking level. Entering Debug mode while another named mode (Ask, Plan) is active SHALL first disable that mode.

#### Scenario: User activates Debug mode
- **WHEN** the user runs `/debug` in an active session
- **THEN** Debug mode becomes active, the session model is switched to the resolved slow model, thinking level is set to `high`, a diagnostic session-context block is injected, and the local log ingestion server is started

#### Scenario: User deactivates Debug mode by toggling
- **WHEN** the user runs `/debug` while Debug mode is already active
- **THEN** Debug mode is disabled, the injected prompt section is removed, the log server is shut down, and the previous model and thinking level are restored

#### Scenario: Previous model and thinking level are snapshotted on entry
- **WHEN** Debug mode is enabled
- **THEN** the session's current model identifier and thinking level are saved in `DebugModeState` so they can be restored on exit

### Requirement: Session elevation on debug mode entry
When Debug mode is activated, the system SHALL call `session.setModel("pi/slow")` (or the value resolved by `model-resolver.ts` at runtime for the slow slot) and `session.setThinkingLevel("high")` before the next agent turn. The session SHALL retain full read and write tool access — no tools are removed or blocked.

#### Scenario: Model and thinking level are elevated on activation
- **WHEN** Debug mode is activated
- **THEN** the active session model is `pi/slow` and the thinking level is `high` for all subsequent turns until Debug mode exits

#### Scenario: Write tools remain available in Debug mode
- **WHEN** Debug mode is active
- **THEN** the agent can call write tools, shell commands, and all other tools without restriction

### Requirement: Diagnostic system prompt injection
The system SHALL inject the verbatim Cursor Debug mode prompt captured in `docs/cursor-prompt-reference.md` when Debug mode is active. The injection SHALL consist of four blocks: (1) announcement block — states the agent is in DEBUG MODE and must not fix without runtime evidence; (2) workflow block — 8-step loop from hypothesis generation through instrumentation, reproduce, evaluate (CONFIRMED/REJECTED/INCONCLUSIVE with cited log lines), fix, verify, and clean up; (3) `<debug_mode_logging>` configuration block — session-specific values (server endpoint, log path, session ID) and NDJSON format rules for JS/TS (fetch POST) vs. all other languages (direct file append), region wrapper syntax, and log payload shape; (4) critical reminders block. Session-specific values (port, log path, session ID) SHALL be substituted at activation time; all other text SHALL be used verbatim. The Debug mode block SHOULD be injected using the same session custom-message pattern used by plan mode.

#### Scenario: Diagnostic prompt is active during debug turns
- **WHEN** Debug mode is active
- **THEN** the effective turn context contains the diagnostic reasoning section

#### Scenario: Diagnostic prompt is removed on exit
- **WHEN** Debug mode is disabled
- **THEN** the injected diagnostic context block is no longer present

### Requirement: Local NDJSON log ingestion server
When Debug mode is activated, the system SHALL start a local HTTP log ingestion server bound to an OS-assigned port (e.g. `Bun.listen` on port 0). The server SHALL accept POST requests to `/ingest/<sessionId>` and write each request body as an NDJSON line to `.pi/debug-<sessionId>.log`. The assigned port, session ID, and log file path SHALL be embedded in the debug mode system prompt injection so the agent can generate correct instrumentation. The server SHALL be shut down when Debug mode is disabled.

#### Scenario: Server starts on an available port
- **WHEN** Debug mode is activated
- **THEN** a local HTTP server is listening on an OS-assigned port, and the port number is written into the session's system prompt

#### Scenario: JS/TS instrumentation can POST to the ingest endpoint
- **WHEN** instrumented JS/TS code runs and calls `fetch("http://127.0.0.1:<port>/ingest/<sessionId>", { method: "POST", body: JSON.stringify(logEntry) })`
- **THEN** the server appends the log entry as a newline-delimited JSON record to `.pi/debug-<sessionId>.log`

#### Scenario: Non-JS/TS instrumentation appends directly to the log file
- **WHEN** instrumented code in any language other than JS/TS appends a NDJSON line to `.pi/debug-<sessionId>.log`
- **THEN** the line is present in the log file for the agent to read on the next evaluation step

#### Scenario: Server shutdown on debug mode exit
- **WHEN** Debug mode is disabled
- **THEN** the local HTTP server is stopped and no longer accepts connections

### Requirement: Structured NDJSON log payload shape
Each log entry written to the debug session log SHALL conform to the following shape: `sessionId` (string), `id` (string, format `log_<timestamp>_<random>`), `timestamp` (Unix milliseconds integer), `location` (string, format `<file>:<line>`), `message` (string), `data` (object, arbitrary), `runId` (string, e.g. `"run1"` or `"post-fix"`), `hypothesisId` (string, single letter A–Z). The agent SHALL instruct users to include `hypothesisId` in every log call so evidence can be correlated to the hypothesis that generated it.

#### Scenario: Valid log entry is stored
- **WHEN** a POST is received at the ingest endpoint with a valid JSON body containing all required fields
- **THEN** the entry is appended as a complete NDJSON line with a trailing newline

### Requirement: Hypothesis-driven instrumentation lifecycle
The agent operating in Debug mode SHALL follow a strict instrumentation lifecycle before proposing any fix: (1) generate 3–5 explicit hypotheses, (2) add instrumentation mapped to each hypothesis (each log tagged with `hypothesisId`), (3) delete the previous session log file to ensure a clean run, (4) call `ask_user` with reproduction steps and Proceed/Mark-as-fixed options, (5) on Proceed — read the log file and evaluate each hypothesis as CONFIRMED / REJECTED / INCONCLUSIVE with cited log-line evidence, (6) propose a fix only when at least one hypothesis is CONFIRMED, (7) clear the log and call `ask_user` again for a post-fix verification run tagged `runId: "post-fix"`, (8) on verified success — remove all instrumentation and revert any code changes tied to rejected hypotheses, (9) deliver a 1–2 line root cause + fix summary.

#### Scenario: Agent generates hypotheses before touching code
- **WHEN** the agent enters the debug loop for a reported failure
- **THEN** the agent states 3–5 explicit hypotheses before adding any instrumentation

#### Scenario: Instrumentation removed only after post-fix verification
- **WHEN** a fix is proposed and the post-fix verification run confirms success
- **THEN** all debug instrumentation is removed and speculative code changes from rejected hypotheses are reverted

#### Scenario: Agent does not remove instrumentation before verification
- **WHEN** a hypothesis is confirmed and a fix is applied but the post-fix verification run has not yet occurred
- **THEN** instrumentation remains in place until the post-fix log proves success

#### Scenario: All hypotheses rejected
- **WHEN** the agent reads the log and all hypotheses are evaluated as REJECTED or INCONCLUSIVE
- **THEN** the agent generates a new set of hypotheses from different subsystems and adds additional instrumentation; it does not guess or propose a fix without evidence

### Requirement: Reproduce/confirm loop via `ask_user` tool
The agent in Debug mode SHALL request the user to reproduce the issue by calling the bundled `ask_user` tool with reproduction steps as the `question`, a hypothesis summary as `context`, and two structured options: `"Proceed"` (issue still present, logs captured) and `"Mark as fixed"` (issue resolved without log analysis). Bundling `ask_user` is a prerequisite of the feature. The system SHALL only fall back when a host or RPC client cannot surface the `ask_user` UI flow.

#### Scenario: Agent presents reproduction steps via ask_user
- **WHEN** instrumentation is in place and the log file has been cleared
- **THEN** the agent calls `ask_user` with the reproduction steps, hypothesis context, and Proceed/Mark-as-fixed options before reading the log

#### Scenario: User selects Proceed
- **WHEN** the user selects "Proceed" in the `ask_user` dialog
- **THEN** the agent reads the session log file and evaluates each hypothesis

#### Scenario: User selects Mark as fixed
- **WHEN** the user selects "Mark as fixed"
- **THEN** the agent skips log analysis, removes instrumentation, and delivers the fix summary

#### Scenario: Host cannot surface ask_user flow
- **WHEN** the host or RPC client cannot surface the `ask_user` UI flow during Debug mode
- **THEN** the agent emits `extension_ui_request { method: "confirm" }` and resumes on `extension_ui_response`

### Requirement: Debug mode status bar indicator
The system SHALL display a visible mode label in the session status bar while Debug mode is active.

#### Scenario: Status bar shows Debug mode
- **WHEN** Debug mode is active
- **THEN** the status bar displays an indicator that the session is in Debug mode

#### Scenario: Status bar clears on deactivation
- **WHEN** Debug mode is disabled
- **THEN** the Debug mode indicator is removed from the status bar
