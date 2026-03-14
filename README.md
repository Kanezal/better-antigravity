<div align="center">

# Better Antigravity

**Community-driven fixes and improvements for [Antigravity IDE](https://antigravity.dev)**

[![Open VSX](https://img.shields.io/open-vsx/v/kanezal/better-antigravity)](https://open-vsx.org/extension/kanezal/better-antigravity)
[![npm](https://img.shields.io/npm/v/better-antigravity)](https://www.npmjs.com/package/better-antigravity)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Antigravity](https://img.shields.io/badge/Antigravity-v1.107.0+-blue.svg)](https://antigravity.dev)
[![Sponsor](https://img.shields.io/badge/Sponsor-Support%20this%20project-ff69b4?logo=githubsponsors&logoColor=white)](https://github.com/Kanezal/better-antigravity#support)

*Antigravity is great. We just make it a little better.*

</div>

---

## What is this?

Better Antigravity is both a **VS Code extension** and an **npm CLI tool** that fixes known bugs and adds quality-of-life features to Antigravity IDE.

| Channel | What it does | Install |
|---------|-------------|---------|
| **Extension** | Auto-applies fixes on startup + chat rename + SDK features | [Open VSX](https://open-vsx.org/extension/kanezal/better-antigravity) |
| **CLI** | Quick one-off patching via `npx` (no extension install needed) | `npx better-antigravity auto-run` |

> [!NOTE]
> The extension includes everything the CLI does, plus extra features powered by the [Antigravity SDK](https://www.npmjs.com/package/antigravity-sdk). If you install the extension, you don't need the CLI.

---

## Install (Extension)

Search for **"Better Antigravity"** in the Extensions panel, or install from [Open VSX](https://open-vsx.org/extension/kanezal/better-antigravity).

Manual install:

```bash
antigravity --install-extension better-antigravity-0.5.0.vsix --force
```

On activation the extension will:
1. **Auto-apply the auto-run fix** (silent, no prompt)
2. **Initialize the SDK** for chat rename and future features
3. **Install the integration script** (prompts for reload on first install, auto-reloads on updates)
4. **Suppress integrity warnings** ("corrupt installation" notification silenced automatically)

---

## Install (CLI only)

If you just want a quick fix without installing the extension:

```bash
# Auto-run fix (terminal execution policy)
npx better-antigravity auto-run            # apply fix
npx better-antigravity auto-run --check    # check status
npx better-antigravity auto-run --revert   # revert to original

# Auto-scroll fix (chat hang during generation)
npx better-antigravity auto-scroll         # apply fix
npx better-antigravity auto-scroll --check # check status
npx better-antigravity auto-scroll --revert # revert to original
```

Custom install path (if Antigravity is not in the default location):

```bash
npx better-antigravity auto-run --path "D:\Antigravity"
```

---

## Features

### Auto-Run Fix

**The problem:** You set **Settings -> Agent -> Terminal Execution -> "Always Proceed"**, but Antigravity **still asks you to click "Run"** on every terminal command.

**Root cause:** The `run_command` step renderer has an `onChange` handler that auto-confirms when you switch the dropdown, but there's **no `useEffect`** that checks the saved policy at mount time.

```javascript
// What exists (only fires on dropdown CHANGE):
onChange = useCallback(_ => {
    setPolicy(_), _ === EAGER && confirm(true)
}, [])

// What's MISSING (should fire on mount):
useEffect(() => {
    if (policy === EAGER && !secureMode) confirm(true)
}, [])
```

**The fix:** Our patcher adds the missing `useEffect`. It uses **structural regex matching** (not hardcoded variable names) so it works across Antigravity versions.

> For the full root cause analysis, pattern matching explanation, and example output, see **[FIXES.md](FIXES.md)**.

### Auto-Scroll Fix

**The problem:** During AI generation, the chat window sometimes **hangs and stops proceeding** if the scroll position isn't at the absolute bottom. You have to manually scroll down to un-stick it.

**Root cause:** The Antigravity chat renderer doesn't auto-scroll to the bottom when new DOM nodes (streamed tokens) are inserted. If the outer or inner scrollable container drifts even a few pixels from the bottom, the generation loop can stall.

**The fix:** A MutationObserver payload is injected into `workbench.html` via a `<script>` tag. The payload:
- Watches for the `.antigravity-chat-scroll-area` container (handles async load/destroy)
- Walks up the DOM tree to discover **all** scrollable ancestor containers
- Pins every scrollable container to the bottom on each mutation
- Pauses auto-scroll when the user manually scrolls up (>50px from bottom)
- Uses `requestAnimationFrame` debouncing to prevent layout thrashing

> For the full technical details, see **[FIXES.md](FIXES.md)**.

### Chat Rename (Extension only)

Rename conversations to custom titles via the [Antigravity SDK](https://www.npmjs.com/package/antigravity-sdk) title proxy. Custom titles override the auto-generated summaries in the sidebar.

### Integrity Check Suppression (Extension only)

When the SDK patches workbench.html, Antigravity shows a sticky "Your installation appears to be corrupt" warning with no dismiss button. As of v0.4.0, the extension automatically updates the checksum in `product.json` after patching so IntegrityService sees `isPure = true`. No warnings on next restart.

Multiple SDK-based extensions are coordinated automatically -- the original checksum is restored only when the last extension uninstalls.

### Status Command (Extension only)

`Ctrl+Shift+P` -> **"Better Antigravity: Show Status"** to see:
- SDK initialization state
- Language Server connection
- Integration script status
- Auto-run fix status per file

---

## Commands

| Command | Description |
|---------|-------------|
| `Better Antigravity: Show Status` | Show extension and fix status |
| `Better Antigravity: Revert Auto-Run Fix` | Restore original auto-run files from backup |
| `Better Antigravity: Revert Auto-Scroll Fix` | Remove auto-scroll patch and restore workbench.html |

---

## Safety

- **Automatic backups** -- original files saved as `.ba-backup` before patching
- **One-command revert** -- CLI `--revert` or extension command
- **Non-destructive** -- patches only add code, never remove existing logic
- **Version-resilient** -- structural regex matching, not hardcoded variable names
- **Async I/O** -- file operations don't block the extension host

---

## Compatibility

| Antigravity Version | Status |
|---------------------|--------|
| 1.107.0 | Tested |
| Other versions | Should work (dynamic pattern matching) |

---

## Project Structure

```
better-antigravity/
├── src/
│   ├── extension.ts       # Extension entry point (thin orchestrator)
│   ├── auto-run.ts        # Auto-run fix logic (async, no vscode dependency)
│   ├── auto-scroll.ts     # Auto-scroll fix logic (workbench.html injection)
│   └── commands.ts        # VS Code command handlers
├── fixes/
│   ├── auto-run-fix/
│   │   └── patch.js       # Standalone CLI patcher (JS AST regex)
│   └── auto-scroll-fix/
│       └── patch.js       # Standalone CLI patcher (HTML injection)
├── static/
│   └── payload.js         # Auto-scroll DOM observer (injected into workbench)
├── cli.js                 # npx entry point
├── build.mjs              # esbuild config
├── publish-ovsx.mjs       # Open VSX publish script
└── package.json           # Dual: npm package + VS Code extension
```

---

## Development

```bash
npm install
npm run build              # Compile extension
npm run watch              # Watch mode
npm run package            # Build VSIX -> out/
npm run publish:ovsx       # Publish to Open VSX (reads .env)
```

The extension depends on [antigravity-sdk](https://www.npmjs.com/package/antigravity-sdk) from the monorepo sibling directory. The build script aliases it automatically.

---

## Contributing

Found another Antigravity bug? Have a fix? PRs are welcome.

### Adding a new fix:

1. Create a folder under `fixes/` with a descriptive name
2. Include a `patch.js` that supports `--check` and `--revert` flags
3. Use structural pattern matching, not hardcoded variable names
4. Update this README's feature table

---

## Disclaimer

> [!WARNING]
> This project is not affiliated with Google or the Antigravity team. These are community patches and improvements. If Antigravity updates and the patches break, simply revert and re-apply (or wait for an updated patch).

**Always report bugs officially** at [antigravity.google/support](https://antigravity.google/support) -- community patches are temporary solutions, not replacements for official fixes.

---

## ❤️ Support

If you find this project useful and want to support its development, you can send **USDT** to:

| Network | Address |
|---------|---------|
| **TON** | `UQCjVh3C3mZc44GjT2IDsS4pmeOoUgRNxWMcb85NS5Bz_v1d` |
| **TRON (TRC20)** | `TH3JKGjNrSDCsjkkSuneaSMZoJYF7CNTXD` |

---

## License

[AGPL-3.0-or-later](LICENSE)
