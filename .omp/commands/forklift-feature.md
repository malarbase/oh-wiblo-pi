<!-- forklift v1 -->
# Forklift: Register a Feature

Register a feature that was just added to this fork (oh-wiblo-pi), so the next rebase cannot drop
it. Use this after the code lands — the registry is the fork's memory, and an unregistered file is
a file the next rebase may overwrite.

## Steps

1. Read the `forklift-maintain` skill — it carries the registry layout, the rule that a path lives
   in exactly one section, and the difference between `owned_paths`, `divergences` and `removals`.
2. Find what the change actually touched:
   ```bash
   git diff --name-only HEAD~1 HEAD
   git log --oneline -1
   ```
3. Add a feature entry to `.forklift/registry.yaml`:
   - `name` — what the feature is, in the fork's own words.
   - `owned_paths` — the files this feature owns, relative to the repo root. One path, one section:
     a file the fork does not override belongs in `divergences` (always take upstream), and a file
     the fork deleted on purpose belongs in `removals` with the reason.
   - `protecting_tests` — at least one test file that passes today and fails if the feature is
     lost. That is the alarm that survives an upstream refactor. If the feature has no testable
     behavior (pure config, docs, build wiring), say so instead: `coverage_exempt: "<why>"`.
   - If the feature puts code inside a file upstream also owns, register the symbol under
     `owned_symbols` — that is what tells the sync which lines to preserve.
4. Refresh what the harness generates and audit the result:
   ```bash
   forklift render --registry .forklift/registry.yaml
   forklift install
   forklift doctor
   ```
5. If `forklift doctor` reports the new feature as uncovered or orphaned, fix the registration
   rather than the check: the audit exists to catch a feature the fork has lost.

## Done means

`forklift doctor` is green (or the only findings are the ones you reported), the feature is in the
registry with its protecting test, and the rendered skill mentions it. If the feature touches a shared
file, confirm the fork's symbol is registered under `owned_symbols` — a feature that survives a
rebase by luck is a feature that will not survive twice.
