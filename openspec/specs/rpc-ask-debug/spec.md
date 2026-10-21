## ADDED Requirements

### Requirement: set_ask_mode RPC command
The system SHALL add a `set_ask_mode` command type to the `RpcCommand` union in `packages/coding-agent/src/modes/rpc/rpc-types.ts`. The command SHALL have the shape `{ id?: string; type: "set_ask_mode"; enabled: boolean }`. When received, the RPC mode handler SHALL invoke shared session-level Ask mode enable/disable helpers, enabling or disabling Ask mode accordingly. The handler SHALL respond with `{ id?: string; type: "response"; command: "set_ask_mode"; success: true }` on success.

#### Scenario: RPC client enables Ask mode
- **WHEN** an RPC client sends `{ type: "set_ask_mode", enabled: true }`
- **THEN** Ask mode is activated on the session and the server responds with `{ type: "response", command: "set_ask_mode", success: true }`

#### Scenario: RPC client disables Ask mode
- **WHEN** an RPC client sends `{ type: "set_ask_mode", enabled: false }`
- **THEN** Ask mode is deactivated and the server responds with `{ type: "response", command: "set_ask_mode", success: true }`

### Requirement: set_debug_mode RPC command
The system SHALL add a `set_debug_mode` command type to the `RpcCommand` union. The command SHALL have the shape `{ id?: string; type: "set_debug_mode"; enabled: boolean }`. When received, the RPC mode handler SHALL invoke shared session-level Debug mode enable/disable helpers. The handler SHALL respond with `{ id?: string; type: "response"; command: "set_debug_mode"; success: true }` on success.

#### Scenario: RPC client enables Debug mode
- **WHEN** an RPC client sends `{ type: "set_debug_mode", enabled: true }`
- **THEN** Debug mode is activated (model elevated, server started) and the server responds with `{ type: "response", command: "set_debug_mode", success: true }`

#### Scenario: RPC client disables Debug mode
- **WHEN** an RPC client sends `{ type: "set_debug_mode", enabled: false }`
- **THEN** Debug mode is deactivated (model restored, server shut down) and the server responds with `{ type: "response", command: "set_debug_mode", success: true }`

### Requirement: mode field in RpcSessionState
The system SHALL add a `mode` field to `RpcSessionState` with the type `"ask" | "debug" | undefined`. The field SHALL be `undefined` (or absent) when the session is in the default agent posture, `"ask"` when Ask mode is active, and `"debug"` when Debug mode is active. This field SHALL be included in any session state snapshot emitted to RPC clients.

#### Scenario: Session state reflects Ask mode
- **WHEN** Ask mode is active and an RPC client reads session state
- **THEN** `RpcSessionState.mode` is `"ask"`

#### Scenario: Session state reflects Debug mode
- **WHEN** Debug mode is active and an RPC client reads session state
- **THEN** `RpcSessionState.mode` is `"debug"`

#### Scenario: Session state has no mode field in default posture
- **WHEN** neither Ask nor Debug mode is active
- **THEN** `RpcSessionState.mode` is `undefined` or absent

### Requirement: Debug mode reproduce/confirm fallback for RPC sessions
When the session is in RPC mode and the client cannot surface the bundled `ask_user` UI flow, the agent in Debug mode SHALL fall back to emitting `extension_ui_request { method: "confirm" }` to pause the reproduction step. The RPC session SHALL resume the agent turn when the client sends `extension_ui_response { confirmed: true }` (Proceed) or `{ confirmed: false }` (Mark as fixed). No new protocol types are needed for this flow — `RpcExtensionUIRequest` and `RpcExtensionUIResponse` already exist.

#### Scenario: RPC client confirms reproduction (Proceed)
- **WHEN** the agent emits `extension_ui_request { method: "confirm" }` and the RPC client responds with `{ confirmed: true }`
- **THEN** the agent reads the session log file and continues the hypothesis evaluation step

#### Scenario: RPC client skips log analysis (Mark as fixed)
- **WHEN** the agent emits `extension_ui_request { method: "confirm" }` and the RPC client responds with `{ confirmed: false }`
- **THEN** the agent removes instrumentation and delivers the fix summary without reading the log

#### Scenario: RPC client surfaces confirm requests to consumers
- **WHEN** Debug mode triggers an `extension_ui_request` confirm flow in RPC mode
- **THEN** the client surface exposes that request to consumers instead of silently discarding it
