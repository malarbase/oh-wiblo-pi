## ADDED Requirements

### Requirement: Ask mode activation via slash command
The system SHALL provide a `/ask` slash command that toggles the session into Ask mode. Invoking `/ask` while Ask mode is already active SHALL disable Ask mode and restore the default agent posture. Entering Ask mode while another named mode (Debug, Plan) is active SHALL first disable that mode. All mode-transition side effects (context injection, status bar update, `appendModeChange`) SHALL occur atomically via the shared `#setActiveMode()` helper; the `/ask` handler SHALL NOT perform these side effects independently.

#### Scenario: User activates Ask mode
- **WHEN** the user runs `/ask` in an active session
- **THEN** Ask mode becomes active, a session-scoped read-only context block is injected for subsequent turns, and the execution-time write guard is registered

#### Scenario: User deactivates Ask mode by toggling
- **WHEN** the user runs `/ask` while Ask mode is already active
- **THEN** Ask mode is disabled, the injected context block is removed, and the execution-time guard is unregistered

#### Scenario: User activates Ask mode while Debug mode is active
- **WHEN** the user runs `/ask` while Debug mode is active
- **THEN** Debug mode is disabled first (log server shut down, prompt section removed, model and thinking level restored), then Ask mode is activated

#### Scenario: User activates Ask mode via mode cycle keybinding
- **WHEN** Ask mode is the next mode in the cycle and the user presses `app.mode.cycle`
- **THEN** the same activation path fires as for `/ask`, including context injection and status bar update

#### Scenario: Status bar reflects Ask mode from any activation path
- **WHEN** Ask mode is activated via `/ask` or via the mode cycle keybinding
- **THEN** the unified `agent_mode` status segment shows the Ask mode label
