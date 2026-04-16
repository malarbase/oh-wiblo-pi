# Install Binary

Build and/or promote the compiled `owp` binary.

## Invocation forms

- `/install-binary build` — compile only; never touches the global binary
- `/install-binary promote [destination]` — copy an already-built binary to the install destination
- `/install-binary [destination]` — build then promote in sequence (default; used after sync-upstream)

`$ARGUMENTS` is either a subcommand (`build` or `promote`) optionally followed by a path, a bare path (destination), or empty.

## Destination resolution (for promote and default form)

1. Explicit path from `$ARGUMENTS` (after stripping the `promote` subcommand if present)
2. Directory containing the currently installed `owp` binary: `dirname $(which owp 2>/dev/null)`
3. Fallback: `~/.local/bin`

## Steps

Parse `$ARGUMENTS` to determine the subcommand and optional destination path:
- If `$ARGUMENTS` starts with `build`, set mode=build; extract any trailing path (ignored for build).
- If `$ARGUMENTS` starts with `promote`, set mode=promote; extract any trailing path as destination.
- Otherwise, set mode=default; treat `$ARGUMENTS` as the destination path if non-empty.

### build step

Run the build (required for `build` and `default` modes):

```bash
cd packages/coding-agent && bun run build
```

If the build exits non-zero, report the error and stop. Do not copy anything.

After a successful build, print a comparison:

```bash
echo "Local:  packages/coding-agent/dist/owp  $(packages/coding-agent/dist/owp --version 2>/dev/null || echo '(version unknown)')"
echo "Global: $(which owp 2>/dev/null || echo '(not on PATH)')  $(owp --version 2>/dev/null || echo '')"
echo ""
echo "Run \`/install-binary promote\` to replace the global binary."
```

Stop here if mode=build.

### promote step

Resolve destination using the priority list above.

Verify `packages/coding-agent/dist/owp` exists. If it does not:

```
Error: packages/coding-agent/dist/owp not found. Run \`/install-binary build\` first.
```

Copy the binary:

```bash
cp packages/coding-agent/dist/owp <resolved_destination>/owp
chmod +x <resolved_destination>/owp
codesign --sign - --force <resolved_destination>/owp
```

Verify the promoted binary:

```bash
<resolved_destination>/owp --version
```

Report success:

```
Promoted: packages/coding-agent/dist/owp → <resolved_destination>/owp
Version: <version output>
```
