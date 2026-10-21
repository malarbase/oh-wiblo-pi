## ADDED Requirements

### Requirement: Skills are re-discovered on new session

When a user starts a new conversation via `newSession()`, and `skills.rediscoverOnNewSession` is `true` (the default), the system SHALL re-run skill discovery using the current `disabledExtensions` settings before rebuilding the system prompt for the new session.

#### Scenario: Skill disabled mid-session, new session started

- **WHEN** a skill is active in the current session's system prompt
- **AND** the user disables that skill via the Extension Control Center
- **AND** the user starts a new session with `/new`
- **THEN** the new session's system prompt SHALL NOT include the disabled skill's instructions

#### Scenario: Skill enabled mid-session, new session started

- **WHEN** a skill is absent from the current session's system prompt (was disabled at process start)
- **AND** the user enables that skill via the Extension Control Center
- **AND** the user starts a new session with `/new`
- **THEN** the new session's system prompt SHALL include the newly enabled skill's instructions

#### Scenario: No skill changes, new session started

- **WHEN** no skill toggles have occurred since the last discovery
- **AND** the user starts a new session with `/new`
- **THEN** the system SHALL skip re-discovery (optimization: same disabled set, same result)
- **AND** the system prompt SHALL be rebuilt with the same skill list as the previous session

### Requirement: Current session is unaffected by skill toggles

The system prompt for the in-progress conversation SHALL NOT change when a skill is toggled via the Extension Control Center. Changes take effect only on the next new session.

#### Scenario: Skill disabled, same session continues

- **WHEN** a skill is active in the current session
- **AND** the user disables the skill
- **AND** the user continues the current conversation without starting `/new`
- **THEN** the agent SHALL still have access to the disabled skill's instructions for the remainder of the current session

### Requirement: Extension Control Center annotation reflects new session requirement

The Extension Control Center SHALL display `[new session]` (not `[restart]`) on any extension whose current effective state differs from the state at the start of the current conversation. The inspector status SHALL read "takes effect on next new session" (not "restart to apply").

#### Scenario: Badge appears after disable

- **WHEN** a skill is toggled off during a session
- **THEN** the extension list SHALL show `[new session]` badge next to the skill name
- **AND** the inspector status SHALL read "⦸ Disabled (manually disabled) (takes effect on next new session)"

#### Scenario: Badge clears after /new

- **WHEN** a skill was toggled and shows `[new session]` badge
- **AND** the user starts a new session with `/new`
- **AND** the user opens the Extension Control Center
- **THEN** the badge SHALL NOT appear (disabled state matches new session's start state)

### Requirement: Re-discovery uses injected callback

`AgentSession` SHALL receive skill re-discovery capability via an optional injected callback (`rediscoverSkills?: () => Promise<Skill[]>`). `AgentSession` SHALL NOT directly import or call `discoverSkills` from the SDK.

#### Scenario: Callback absent (non-skill context)

- **WHEN** `AgentSession` is constructed without a `rediscoverSkills` callback
- **AND** `newSession()` is called
- **THEN** the system SHALL proceed without re-discovery, retaining the existing system prompt's skill content


### Requirement: Re-discovery is user-configurable

A boolean setting `skills.rediscoverOnNewSession` (default `true`) SHALL be exposed in **Settings → Tasks**. When set to `false`, `newSession()` SHALL skip re-discovery entirely and rebuild the system prompt with the existing skill list.

#### Scenario: Toggle disabled, skill change made, new session started

- **WHEN** `skills.rediscoverOnNewSession` is `false`
- **AND** the user toggles a skill via the Extension Control Center
- **AND** the user starts a new session with `/new`
- **THEN** the new session's system prompt SHALL reflect the skill list from the previous discovery (no re-scan occurs)

#### Scenario: Toggle enabled (default), skill change made, new session started

- **WHEN** `skills.rediscoverOnNewSession` is `true`
- **AND** the user toggles a skill
- **AND** the user starts a new session with `/new`
- **THEN** the new session's system prompt SHALL reflect the current `disabledExtensions` state (re-scan occurs)