# Fixes — Technical Details

Detailed root cause analysis and patch descriptions for each fix in Better Antigravity.

---

## Auto-Run Fix

**Status:** Working  
**Affected versions:** 1.107.0+  
**Files patched:** `workbench.desktop.main.js`, `jetskiAgent.js`

### The Problem

You set **Settings -> Agent -> Terminal Execution -> "Always Proceed"**, but Antigravity **still asks you to click "Run"** on every single terminal command. Every. Single. Time.

The setting saves correctly, Strict Mode is off -- it just doesn't work.

### Root Cause

Found in the source code: the `run_command` step renderer component has an `onChange` handler that auto-confirms commands when you switch the dropdown to "Always run" **on a specific step**. But there's **no `useEffect` hook** that checks the saved policy at mount time and auto-confirms **new steps**.

In other words: the UI reads your setting, displays the correct dropdown value, but never actually acts on it automatically.

```javascript
// What exists (only fires on dropdown CHANGE):
y = Mt(_ => {
    setTerminalAutoExecutionPolicy(_),
    _ === EAGER && confirm(true) // <- only when you manually switch
}, [])

// What's MISSING (should fire on component mount):
useEffect(() => {
    if (policy === EAGER && !secureMode) confirm(true) // <- auto-confirm new steps
}, [])
```

### How the Patch Works

The patcher uses **structural regex matching** to find the `onChange` handler in the minified source. It matches the code by shape, not by variable names -- so it works even when Antigravity re-minifies on update.

**Step 1: Find the onChange handler**

Pattern: `<callback>=<useCallback>((<arg>)=>{<setFn>(<arg>),<arg>===<ENUM>.EAGER&&<confirm>(!0)},[...])`

This matches the handler structurally:
- An assignment to a variable
- A `useCallback` call
- Arrow function with one argument
- Two expressions: set state + check EAGER and confirm

**Step 2: Extract variable names from context**

From the surrounding 3000 characters, extract:
- `policyVar`: `<var>=<something>?.terminalAutoExecutionPolicy??<ENUM>.OFF`
- `secureVar`: `<var>=<something>?.secureModeEnabled??!1`
- `useEffectFn`: the most frequently used short-named function matching the `fn(()=>{...})` pattern (frequency analysis)

**Step 3: Generate and inject the patch**

```javascript
/*BA:autorun*/<useEffect>(()=>{<policyVar>===<ENUM>.EAGER&&!<secureVar>&&<confirm>(!0)},[])
```

The patch is injected immediately after the `onChange` handler's closing bracket.

### Example Output

```
 Antigravity "Always Proceed" Auto-Run Fix

 C:\Users\user\AppData\Local\Programs\Antigravity
 Version: 1.107.0 (IDE 1.19.5)

  [workbench] Found onChange at offset 12362782
     callback=Mt, enum=Dhe, confirm=b
     policyVar=u
     secureVar=d
     useEffect=mn (confidence: 30 hits)
  [workbench] Patched (+43 bytes)
  [jetskiAgent] Found onChange at offset 8388797
     callback=ve, enum=rx, confirm=F
     policyVar=d
     secureVar=f
     useEffect=At (confidence: 55 hits)
  [jetskiAgent] Patched (+42 bytes)

Done! Restart Antigravity.
```

### Safety

- Original files are saved as `.ba-backup` before patching
- The patch marker `/*BA:autorun*/` prevents double-patching
- Only **adds** code, never removes existing logic
- `--revert` restores the original file from backup
- Async I/O in the extension prevents blocking the Extension Host

### Why two files?

The `run_command` step renderer exists in **two** bundles:
1. `workbench.desktop.main.js` -- the main workbench bundle (~15MB)
2. `jetskiAgent.js` -- the Cascade chat panel webview (~10MB)

Both contain the same bug with slightly different minified variable names. The structural matcher handles both transparently.
 
---

## Auto-Scroll Fix

**Status:** Working  
**Affected versions:** 1.107.0+  
**Files patched:** `workbench.html`

### The Problem

During AI generation, the chat window sometimes **hangs and stops proceeding** if the scroll position isn't at the absolute bottom. You have to manually scroll down to un-stick it. This is especially frustrating during long generation sessions.

### Root Cause

The Antigravity chat renderer uses a scrollable container (`.antigravity-chat-scroll-area`) but doesn't ensure the scroll position is pinned to the bottom when new DOM nodes are inserted during streaming. Additionally, the chat area is nested inside **multiple** scrollable ancestors (inner panel + outer sidebar), and even if the inner container is at the bottom, the outer one may not be — causing the same hang.

### How the Patch Works

Unlike the auto-run fix (which patches minified JavaScript), the auto-scroll fix **injects a `<script>` tag** into `workbench.html`. This gives us unrestricted DOM access in the Electron renderer process.

**Step 1: Locate workbench.html**

The patcher checks both known paths for version resilience:
- `resources/app/out/vs/code/electron-browser/workbench/workbench.html`
- `resources/app/out/vs/code/electron-sandbox/workbench/workbench.html`

**Step 2: Deploy payload**

The `payload.js` file is copied next to `workbench.html` as `ba-auto-scroll-payload.js`. A `<script>` tag referencing it is injected before `</html>`.

**Step 3: Update checksums**

The `product.json` checksums dictionary is updated with the SHA256 hash of the modified `workbench.html`, suppressing the "corrupt installation" warning.

### The Payload

The injected `payload.js` implements a multi-level scroll pinning strategy:

1. **Root MutationObserver** — watches `document.body` for the chat container to appear/disappear (handles async load and view switching)
2. **Ancestor walking** — discovers all scrollable parents by walking up the DOM tree from the chat container
3. **Content observer** — watches the chat container for `childList`, `subtree`, and `characterData` mutations
4. **Scroll pinning** — on each mutation, scrolls ALL tracked containers to `scrollHeight` using `requestAnimationFrame`
5. **Manual scroll detection** — pauses auto-scroll if the user scrolls >50px from the bottom on any container; resumes when they return to the bottom

### Safety

- Original files saved as `.ba-backup` before patching
- The patch marker `<!-- BA: Auto-Scroller Payload -->` prevents double-patching
- Only **adds** a script tag, never removes existing HTML
- `--revert` restores the original file from backup and removes the deployed payload
- Deployed payload file is cleaned up on revert
