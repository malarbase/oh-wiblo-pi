## ADDED Requirements

### Requirement: install-binary slash command
A slash command at `.omp/commands/install-binary.md` SHALL support three invocation forms:

- `/install-binary build` — compiles `owp` to `packages/coding-agent/dist/owp` and prints the local binary path and version. Does NOT copy to any `$PATH` location. This is the safe step during active feature development: the global binary is never touched.
- `/install-binary promote [destination]` — copies the already-built `packages/coding-agent/dist/owp` to the install destination. Destination resolution follows the same order as the default form. Refuses to promote if `dist/owp` does not exist (i.e., `build` was not run first).
- `/install-binary [destination]` (no subcommand) — runs build followed by promote in sequence. This is the post-sync default. Destination is optional and resolves as described for `promote`.

Destination resolution order for `promote` and the default form: (1) explicit argument, (2) directory of the currently installed `owp` binary (`dirname $(which owp)`), (3) `~/.local/bin` as fallback.

The command SHALL fail and report an error if the build step fails. It SHALL NOT promote a binary if the build did not succeed. On success it SHALL verify the promoted binary responds to `owp --version`.

After a successful `build`, the command SHALL print:
- Local binary path (`packages/coding-agent/dist/owp`) and its version
- Global binary path and version (if `owp` is on `$PATH`), or a note that no global binary exists
- A reminder that `/install-binary promote` is needed to replace the global

This output gives the developer an at-a-glance comparison so they can decide whether the local build is ready to promote.

#### Scenario: Build only
- **WHEN** the user runs `/install-binary build`
- **THEN** `bun run build:binary` runs, the output binary lands at `packages/coding-agent/dist/owp`, and the command prints the local and global versions side by side without copying anything

#### Scenario: Promote after build
- **WHEN** the user runs `/install-binary promote` and `dist/owp` exists
- **THEN** `dist/owp` is copied to the resolved destination and the promoted binary is verified with `owp --version`

#### Scenario: Promote without prior build
- **WHEN** the user runs `/install-binary promote` and `dist/owp` does not exist
- **THEN** the command fails with an error explaining that `/install-binary build` must be run first

#### Scenario: Default form (build + promote) with no arguments and owp on PATH
- **WHEN** the user runs `/install-binary` with no arguments and `owp` is already on `$PATH`
- **THEN** the binary is rebuilt and the new binary is promoted to the directory containing the existing `owp` installation

#### Scenario: Default form with explicit destination
- **WHEN** the user runs `/install-binary /usr/local/bin`
- **THEN** the binary is rebuilt and promoted to `/usr/local/bin/owp`

#### Scenario: Build fails
- **WHEN** `bun run build:binary` exits non-zero
- **THEN** the command reports the build error and does not promote any binary

#### Scenario: No existing owp on PATH and no argument
- **WHEN** `which owp` returns nothing and no destination is provided
- **THEN** the command uses `~/.local/bin` as the destination
### Requirement: sync-upstream references install-binary
The `.omp/skills/sync-upstream/SKILL.md` § After Resolution steps SHALL include a step instructing the developer to run `/install-binary` to reinstall the `owp` binary after a successful upstream sync.

#### Scenario: Developer follows post-sync steps
- **WHEN** the sync-upstream skill's After Resolution steps are followed
- **THEN** the installed `owp` binary is updated to the latest built version
