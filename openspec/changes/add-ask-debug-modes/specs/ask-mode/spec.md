## ADDED Requirements

### Requirement: Ask mode activation via slash command
The system SHALL provide a `/ask` slash command that toggles the session into Ask mode. Invoking `/ask` while Ask mode is already active SHALL disable Ask mode and restore the default agent posture. Entering Ask mode while another named mode (Debug, Plan) is active SHALL first disable that mode.

#### Scenario: User activates Ask mode
- **WHEN** the user runs `/ask` in an active session
- **THEN** Ask mode becomes active, a session-scoped read-only context block is injected for subsequent turns, and the execution-time write guard is registered

#### Scenario: User deactivates Ask mode by toggling
- **WHEN** the user runs `/ask` while Ask mode is already active
- **THEN** Ask mode is disabled, the injected context block is removed, and the execution-time guard is unregistered

#### Scenario: User activates Ask mode while Debug mode is active
- **WHEN** the user runs `/ask` while Debug mode is active
- **THEN** Debug mode is disabled first (log server shut down, prompt section removed, model and thinking level restored), then Ask mode is activated

### Requirement: Read-only enforcement via dual-layer defense
The system SHALL enforce Ask mode's read-only constraint using two independent layers: (1) a session-scoped prompt/context override that instructs the model it MUST NOT make edits or run non-readonly tools, and (2) a guaranteed execution-time guard that intercepts any write-tool call and returns an error result to the model instead of executing it. The system MUST NOT rely on the prompt alone as the sole enforcement mechanism, and the execution-time guard MUST continue to function even when no optional extensions are loaded.

#### Scenario: Model attempts a write tool call in Ask mode
- **WHEN** the model attempts to call a write tool (e.g. `edit_file`, `bash` with a mutating command) while Ask mode is active
- **THEN** the execution-time guard intercepts the call, returns an error result `"Cannot use write tools in Ask mode. Switch to Agent mode to make changes."`, and the tool is not executed

#### Scenario: Read-only tools are permitted in Ask mode
- **WHEN** the model calls a read-only tool (e.g. `read_file`, `grep`, `list_directory`, `read_lints`) while Ask mode is active
- **THEN** the tool executes normally and returns its result to the model

#### Scenario: Ask mode still blocks writes without extensions
- **WHEN** Ask mode is active in a session where no optional extensions are loaded
- **THEN** write-tool calls are still intercepted and blocked at execution time

### Requirement: Decline and redirect for change requests
The system prompt override injected during Ask mode SHALL instruct the model that if the user asks for any code change or implementation, the model MUST decline and explicitly prompt the user to switch to Agent mode. The model SHALL NOT silently comply even if the user insists.

#### Scenario: User asks for a code change in Ask mode
- **WHEN** the user requests an edit, implementation, or file modification while Ask mode is active
- **THEN** the agent declines the request and responds with a suggestion to switch to Agent mode (e.g. "I'm in Ask mode and can't make changes. Run `/ask` to exit Ask mode, then ask again.")

### Requirement: Ask mode system prompt content
The session-scoped context block injected in Ask mode SHALL include: a hard override statement ("You MUST NOT make any edits, run any non-readonly tools, or otherwise make any changes. This supersedes any other instructions"), an explicit list of permitted operations (read files, search codebase, grep patterns, list directories, read lints/diagnostics), and the decline-and-redirect instruction for change requests. The block SHOULD be injected using the same session custom-message pattern used by plan mode.

#### Scenario: Prompt section is present while Ask mode is active
- **WHEN** Ask mode is active during a turn
- **THEN** the effective turn context contains the Ask-mode read-only override section

#### Scenario: Prompt section is absent after Ask mode is disabled
- **WHEN** Ask mode is disabled
- **THEN** the injected Ask-mode context block is no longer present in subsequent turns

### Requirement: Ask mode status bar indicator
The system SHALL display a visible mode label in the session status bar while Ask mode is active, following the same pattern as the existing `plan` mode segment.

#### Scenario: Status bar shows Ask mode
- **WHEN** Ask mode is active
- **THEN** the status bar displays an indicator that the session is in Ask mode

#### Scenario: Status bar clears on deactivation
- **WHEN** Ask mode is disabled
- **THEN** the Ask mode indicator is removed from the status bar
