## ADDED Requirements

### Requirement: Debug mode activation via slash command
The system SHALL provide a `/debug` slash command that toggles the session into Debug mode. Invoking `/debug` while Debug mode is already active SHALL disable Debug mode and restore the previous model and thinking level. Entering Debug mode while another named mode (Ask, Plan) is active SHALL first disable that mode. All mode-transition side effects (context injection, status bar update, `appendModeChange`) SHALL occur atomically via the shared `#setActiveMode()` helper; the `/debug` handler SHALL NOT perform these side effects independently.

#### Scenario: User activates Debug mode
- **WHEN** the user runs `/debug` in an active session
- **THEN** Debug mode becomes active, the session model is switched to the resolved slow model, thinking level is set to `high`, a diagnostic session-context block is injected, and the local log ingestion server is started

#### Scenario: User deactivates Debug mode by toggling
- **WHEN** the user runs `/debug` while Debug mode is already active
- **THEN** Debug mode is disabled, the injected prompt section is removed, the log server is shut down, and the previous model and thinking level are restored

#### Scenario: User activates Debug mode while Ask mode is active
- **WHEN** the user runs `/debug` while Ask mode is active
- **THEN** Ask mode is disabled first (context block removed, write guard unregistered), then Debug mode is activated

#### Scenario: User activates Debug mode via mode cycle keybinding
- **WHEN** Debug mode is the next mode in the cycle and the user presses `app.mode.cycle`
- **THEN** the same activation path fires as for `/debug`, including model elevation, context injection, log server start, and status bar update

#### Scenario: Status bar reflects Debug mode from any activation path
- **WHEN** Debug mode is activated via `/debug` or via the mode cycle keybinding
- **THEN** the unified `agent_mode` status segment shows the Debug mode label
