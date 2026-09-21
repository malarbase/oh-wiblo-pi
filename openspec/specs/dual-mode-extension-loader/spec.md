## ADDED Requirements

### Requirement: Binary execution context detection
`packages/coding-agent/src/config.ts` SHALL export two boolean constants:

- `isBunBinary` — `true` when `import.meta.url` contains `$bunfs`, `~BUN`, or `%7EBUN` (markers Bun embeds in the virtual filesystem of a compiled binary)
- `isBunRuntime` — `true` when `process.versions.bun` is defined (covers both compiled binary and `bun run`)

#### Scenario: Running as compiled binary
- **WHEN** the process URL contains `$bunfs`
- **THEN** `isBunBinary` is `true` and `isBunRuntime` is `true`

#### Scenario: Running via `bun run`
- **WHEN** `process.versions.bun` is defined and `import.meta.url` contains no virtual FS marker
- **THEN** `isBunBinary` is `false` and `isBunRuntime` is `true`

### Requirement: jiti-based extension loader
The extension loader SHALL use `@mariozechner/jiti` to load user-authored TypeScript extension files in all execution contexts. Native `Bun.import()` SHALL NOT be used as the loading mechanism for extension files.

`packages/coding-agent/package.json` SHALL declare `@mariozechner/jiti` at `^2.6.5` as a production dependency.

#### Scenario: Extension loaded in dev mode
- **WHEN** `isBunBinary` is `false` and an extension TypeScript file is loaded
- **THEN** jiti transpiles the file using an alias map that resolves `@oh-my-pi/*` and `@sinclair/typebox` to workspace `node_modules` paths

#### Scenario: Extension loaded from compiled binary
- **WHEN** `isBunBinary` is `true` and an extension TypeScript file is loaded from the user's filesystem
- **THEN** jiti transpiles the file with `virtualModules` containing the statically-bundled `@oh-my-pi/*` and `@sinclair/typebox` packages, and `tryNative: false` so all module resolution goes through jiti

#### Scenario: Extension imports package outside virtual modules
- **WHEN** `isBunBinary` is `true` and an extension imports a package not listed in `VIRTUAL_MODULES`
- **THEN** the loader surfaces a load error identifying the extension path and the missing module

### Requirement: Static virtual module declarations
The loader SHALL declare all packages in `VIRTUAL_MODULES` as top-level static imports so Bun includes them unconditionally in the compiled binary. The set SHALL include: `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-agent-core`, `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-utils`, `@sinclair/typebox`. Dynamic imports SHALL NOT be used for these declarations.

#### Scenario: Virtual module available in compiled binary
- **WHEN** the binary is compiled and an extension calls `import "@oh-my-pi/pi-utils"`
- **THEN** the import resolves to the in-binary copy without any filesystem lookup
