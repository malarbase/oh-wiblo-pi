## ADDED Requirements

### Requirement: Metadata fields are surfaced from SKILL.md frontmatter

The system SHALL parse `metadata.author`, `metadata.repo`, and `metadata.tags` from SKILL.md frontmatter and expose them as typed fields on the `Skill` capability type and the `Extension` dashboard type.

#### Scenario: Metadata fields parsed correctly

- **WHEN** a SKILL.md contains frontmatter with `metadata: { author: "malar", repo: "github.com/malar/skills", tags: ["curator", "skills"] }`
- **THEN** the loaded `Skill` has `author: "malar"`, `repo: "github.com/malar/skills"`, `tags: ["curator", "skills"]`

#### Scenario: Metadata fields are optional

- **WHEN** a SKILL.md has no metadata or partial metadata (e.g., only `author` but no `repo`)
- **THEN** missing fields are `undefined` on the `Skill` and `Extension` types

### Requirement: Skills are grouped by metadata.repo as primary axis

The system SHALL group skills by their `metadata.repo` value. If unavailable, it SHALL group by `metadata.author`. If neither is present, it SHALL fall back to directory-based grouping (one level of nesting). This fallback chain is applied **per-skill within the active axis**: under the repo axis a skill with no `repo` resolves to `author ?? group`; under the author axis it resolves to `group`; under the dir axis no further fallback applies.

#### Scenario: Repo-based grouping applied

- **WHEN** multiple skills have `metadata.repo: "github.com/pbakaus/impeccable"`
- **THEN** they appear under a single group-header labeled "github.com/pbakaus/impeccable" in the extensions dashboard

#### Scenario: Author fallback when repo is missing

- **WHEN** a skill has `metadata.author: "malar"` but no `metadata.repo`
- **THEN** it groups under author "malar" if no repo-based group exists

#### Scenario: Directory fallback when metadata is absent

- **WHEN** a skill at `skills/pbakaus-impeccable/code-review/SKILL.md` has no metadata
- **THEN** it groups under directory name "pbakaus-impeccable"

### Requirement: Disabling a group disables all matching skills via metadata or directory

The system SHALL treat all skills matching a group criterion as disabled when a synthetic entry is present in `disabledExtensions`: `skill-repo:<repo>`, `skill-author:<author>`, `skill-dir:<dirname>`, or `skill-tag:<tag>`. Each prefix uses the same fallback chain as the grouping UI: `skill-repo:<v>` matches skills where `(repo ?? author ?? group) === v`; `skill-author:<v>` matches skills where `(author ?? group) === v`; `skill-dir:<v>` and `skill-tag:<v>` match on the literal `group` field and `tags` array respectively.

#### Scenario: Repo-based group disable

- **WHEN** `disabledExtensions` contains `skill-repo:github.com/pbakaus/impeccable`
- **THEN** all skills where `(metadata.repo ?? metadata.author ?? group) === "github.com/pbakaus/impeccable"` have `state: "disabled"`

#### Scenario: Author-based group disable

- **WHEN** `disabledExtensions` contains `skill-author:malar`
- **THEN** all skills where `(metadata.author ?? group) === "malar"` have `state: "disabled"`

#### Scenario: Directory-based group disable

- **WHEN** `disabledExtensions` contains `skill-dir:pbakaus-impeccable`
- **THEN** all skills where `group === "pbakaus-impeccable"` have `state: "disabled"`

### Requirement: Individual skill toggle overrides group disabled state

A skill is disabled only if no individual `skill:<name>` entry exists in `disabledExtensions` when its group is disabled; an explicit `skill:<name>` entry re-enables the skill even when its group is disabled.

#### Scenario: Individual re-enable within disabled group

- **WHEN** `disabledExtensions` contains `skill-repo:github.com/pbakaus/impeccable`
- **AND** the user individually enables `skill:code-review`
- **THEN** `skill:code-review` is NOT added to `disabledExtensions`
- **AND** `skill:code-review` has `state: "active"` in the dashboard

#### Scenario: Individual disable within enabled group

- **WHEN** no group entry disables a skill's group
- **AND** the user individually disables `skill:code-review`
- **THEN** `skill:code-review` is added to `disabledExtensions`
- **AND** other skills in the group remain `state: "active"`

### Requirement: Extensions dashboard shows group-header rows per grouping axis

Within a provider tab, the system SHALL render a group-header row for each group, positioned between the Master Switch and individual skill rows. The group-header acts as a sub-master switch: toggling it disables/enables all matching skills.

#### Scenario: Group-header rendered with repo-based grouping

- **WHEN** the user navigates to a provider tab containing repo-grouped skills
- **THEN** a group-header appears for each distinct `metadata.repo` value, showing repo URL and member count
- **AND** individual skills are indented beneath their group-header

#### Scenario: Group-header reflects fully-disabled state

- **WHEN** all skills in a group are disabled (via group entry or individual entries)
- **THEN** the group-header checkbox shows unchecked state

#### Scenario: Group-header reflects mixed state

- **WHEN** some skills in a group are disabled and others are active
- **THEN** the group-header checkbox shows indeterminate/mixed state icon

#### Scenario: Space on group-header toggles all members

- **WHEN** the user selects a group-header and presses Space
- **THEN** all skills in the group are toggled
- **AND** the appropriate synthetic entry (`skill-repo:`, `skill-author:`, `skill-dir:`, or `skill-tag:`) is written to or removed from `disabledExtensions`


#### Scenario: Group toggle reflects immediately without disk round-trip

- **WHEN** the user toggles a group-header
- **THEN** the checkbox state flips synchronously in the current render frame via in-memory state re-evaluation
- **AND** the async disk reload reconciles any external changes without a visible second flip

### Requirement: Tag-based grouping axis

The system SHALL support `tag` as a fourth grouping axis, cycled via Ctrl+G after `dir`. Under the tag axis, a skill may appear under multiple group-headers (one per tag). Toggling a group-header under the tag axis writes `skill-tag:<value>` to `disabledExtensions`; enabling removes the entry and removes any individual `skill:<name>` entries for skills matching that tag.

#### Scenario: Tag axis groups skills by tag values

- **WHEN** the active grouping axis is `tag`
- **AND** a skill has `tags: ["convex", "database"]`
- **THEN** it appears under both the `convex` and `database` group-headers

#### Scenario: Tag-based group disable

- **WHEN** `disabledExtensions` contains `skill-tag:convex`
- **THEN** all skills whose `tags` array includes `"convex"` have `state: "disabled"`

### Requirement: Tag prefix search syntax in extensions list

The system SHALL support `tag:<value>` tokens in the extensions search query. Multiple `tag:` tokens are ANDed. Non-tag tokens are fuzzy-matched against name, description, trigger, and provider. This allows filtering by tag without a separate UI control.

#### Scenario: Tag prefix filters by tag

- **WHEN** the user types `tag:convex` in the search bar
- **THEN** only skills with `"convex"` in their `tags` array are shown

#### Scenario: Tag prefix combines with fuzzy text

- **WHEN** the user types `tag:convex review`
- **THEN** only skills with `"convex"` in `tags` AND `"review"` in name/description are shown

### Requirement: Install-time metadata stamping

When `find-skills` skill or `npx skills` CLI installs a skill, it SHALL populate `metadata.author`, `metadata.repo`, and `metadata.tags` in the installed `SKILL.md` frontmatter if not already present. Values are inferred from the install source and any filtering criteria.

#### Scenario: Repo stamped from install source

- **WHEN** a skill is installed via `npx skills add malar/skill-curator`
- **THEN** the installed `SKILL.md` has `metadata.repo: "github.com/malar/skill-curator"` (or the source repo URL)

#### Scenario: Author stamped from install context

- **WHEN** a skill is installed and no `metadata.author` exists
- **THEN** the system stamps `metadata.author` based on the installer context (e.g., the owner of the source repo or a default)

#### Scenario: Existing metadata is preserved

- **WHEN** a skill already has `metadata.repo` and `metadata.author`
- **THEN** the installer does not overwrite them

### Requirement: Ungrouped skills are unaffected by group toggles

Skills with no metadata and no directory group SHALL NOT be affected by any group toggle and SHALL appear at the top level of the provider tab.

#### Scenario: Ungrouped skills render separately

- **WHEN** a provider tab contains both grouped and ungrouped skills
- **THEN** ungrouped skills appear at the same indentation level as group-headers
- **AND** toggling a group-header does not change ungrouped skill states


### Requirement: Non-skill extensions in a skill provider tab render flat

When a provider tab contains both skill and non-skill extensions, the system SHALL render skill extensions in group-header sections and non-skill extensions as a flat list below all skill groups. Non-skill extensions are never included in skill group-header counts and are not affected by group toggles.