## ADDED Requirements

### Requirement: session_directory event on ExtensionAPI
`ExtensionAPI` SHALL expose a `session_directory` event. Extensions subscribe via `pi.on("session_directory", handler)`. The handler receives `{ type: "session_directory"; cwd: string }` and MAY return `{ sessionDir: string }` to redirect where sessions are stored.

This event is CLI-only and startup-only. It SHALL be fired once, before the session manager is created, and SHALL NOT be emitted in SDK mode or on subsequent `/new` or `/resume` actions. If multiple extensions return a `sessionDir`, the last non-empty value wins.

#### Scenario: Extension redirects session storage
- **WHEN** a loaded extension handles `session_directory` and returns `{ sessionDir: "/custom/path" }`
- **THEN** sessions are stored under `/custom/path` for that invocation

#### Scenario: Multiple extensions handle session_directory
- **WHEN** two extensions both return a `sessionDir` value
- **THEN** the value from the last handler to return a non-empty `sessionDir` is used

#### Scenario: No extension redirects sessions
- **WHEN** no loaded extension handles `session_directory`
- **THEN** the session directory resolves to the default (`~/.omp/agent/sessions/`)

### Requirement: session_directory yields to --session-dir flag
The `session_directory` event result SHALL be overridden by an explicit `--session-dir` CLI flag. The flag takes precedence over any extension-provided path.

#### Scenario: --session-dir flag overrides extension
- **WHEN** an extension returns a custom `sessionDir` AND `--session-dir` is passed on the CLI
- **THEN** the explicit `--session-dir` value is used

### Requirement: session_directory not emitted in SDK mode
The `session_directory` event SHALL NOT be emitted when the coding agent is used via the programmatic SDK (`createAgentSession`).

#### Scenario: SDK mode suppresses session_directory
- **WHEN** a session is created via `createAgentSession`
- **THEN** no `session_directory` event is fired, regardless of loaded extensions
