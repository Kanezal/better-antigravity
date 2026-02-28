<div align="center">

# Better Antigravity

**Community-driven fixes and improvements for [Antigravity IDE](https://antigravity.dev)**

[![npm](https://img.shields.io/npm/v/better-antigravity)](https://www.npmjs.com/package/better-antigravity)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Kanezal/better-antigravity/pulls)
[![Antigravity](https://img.shields.io/badge/Antigravity-v1.107.0+-blue.svg)](https://antigravity.dev)

*Antigravity is great. We just make it a little better.*

</div>

---

## What is this?

A collection of **hotfixes and patches** for bugs in Antigravity IDE that haven't been officially resolved yet. Each fix is a standalone script you can apply and revert safely.

> **Note:** These are unofficial community patches. Use at your own risk. All fixes create automatic backups and can be reverted with a single command.

---

## Quick Start

```bash
npx better-antigravity auto-run
```

That's it. Restart Antigravity and your "Always Proceed" setting actually works now.

---

## Available Fixes

| Fix | Description | Status |
|-----|-------------|--------|
| [**auto-run-fix**](#auto-run-fix) | "Always Proceed" terminal policy doesn't auto-execute commands | ✅ Working |

---

## Auto-Run Fix

### The Problem

You set **Settings → Agent → Terminal Execution → "Always Proceed"**, but Antigravity **still asks you to click "Run"** on every single terminal command. Every. Single. Time.

The setting saves correctly, Strict Mode is off — it just doesn't work.

### Root Cause

Found in the source code: the `run_command` step renderer component has an `onChange` handler that auto-confirms commands when you switch the dropdown to "Always run" **on a specific step**. But there's **no `useEffect` hook** that checks the saved policy at mount time and auto-confirms **new steps**.

In other words: the UI reads your setting, displays the correct dropdown value, but never actually acts on it automatically.

```javascript
// What exists (only fires on dropdown CHANGE):
y = Mt(_ => {
    setTerminalAutoExecutionPolicy(_),
    _ === EAGER && confirm(true) // ← only when you manually switch
}, [])

// What's MISSING (should fire on component mount):
useEffect(() => {
    if (policy === EAGER && !secureMode) confirm(true) // ← auto-confirm new steps
}, [])
```

### The Fix

Our patcher adds the missing `useEffect`. It uses **regex pattern matching** to find code by structure — not by minified variable names — so it works across Antigravity versions.

### Usage

**Via npx (recommended):**

```bash
npx better-antigravity auto-run            # apply fix
npx better-antigravity auto-run --check    # check status
npx better-antigravity auto-run --revert   # revert to original
```

**Via clone:**

```bash
git clone https://github.com/Kanezal/better-antigravity.git
cd better-antigravity
node fixes/auto-run-fix/patch.js
```

### Example Output

```
╔══════════════════════════════════════════════════╗
║  Antigravity "Always Proceed" Auto-Run Fix      ║
╚══════════════════════════════════════════════════╝

📍 C:\Users\user\AppData\Local\Programs\Antigravity
📦 Version: 1.107.0 (IDE 1.19.5)

  📋 [workbench] Found onChange at offset 12362782
     callback=Mt, enum=Dhe, confirm=b
     policyVar=u
     secureVar=d
     useEffect=mn (confidence: 30 hits)
  ✅ [workbench] Patched (+43 bytes)
  📋 [jetskiAgent] Found onChange at offset 8388797
     callback=ve, enum=rx, confirm=F
     policyVar=d
     secureVar=f
     useEffect=At (confidence: 55 hits)
  ✅ [jetskiAgent] Patched (+42 bytes)

✨ Done! Restart Antigravity.
```

### Compatibility

| Antigravity Version | Status |
|---------------------|--------|
| 1.107.0 | ✅ Tested |
| Other versions | Should work (dynamic pattern matching) |

---

## Safety

- **Automatic backups** — original files are saved as `.bak` before patching
- **One-command revert** — run with `--revert` to restore originals instantly
- **Non-destructive** — patches only add code, never remove existing logic
- **Version-resilient** — uses structural regex matching, not hardcoded variable names
- **Syntax validation** — verifies code structure before writing

---

## Project Structure

```
better-antigravity/
├── cli.js              # npx entry point
├── package.json        # npm package config
├── README.md
├── LICENSE
└── fixes/
    └── auto-run-fix/
        └── patch.js    # The patcher script
```

---

## Contributing

Found another Antigravity bug? Have a fix? PRs are welcome!

### Adding a new fix:

1. Create a folder under `fixes/` with a descriptive name
2. Include a `patch.js` that supports `--check` and `--revert` flags
3. Add a `README.md` with root cause analysis
4. Update the main README's fix table

### Guidelines:

- Always create backups before patching
- Use structural pattern matching, not hardcoded variable names
- Support `--check` and `--revert` flags
- Test on a clean Antigravity installation

---

## Disclaimer

> [!WARNING]
> This project is not affiliated with Google or the Antigravity team. These are community patches for known bugs. If Antigravity updates and the patches break, simply revert and re-apply (or wait for an updated patch).

**Always report bugs officially** at [antigravity.google/support](https://antigravity.google/support) — community patches are temporary solutions, not replacements for official fixes.

---

## License

[AGPL-3.0-or-later](LICENSE)
