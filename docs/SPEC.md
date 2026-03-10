# Technical Specification: Antigravity Auto-Scroller Patch

## 1. Overview
The goal of this project is to build a VS Code extension that injects a custom JavaScript payload into the Antigravity IDE frontend. The payload solves a critical bug: the "auto-continue" generative loop hangs and fails to proceed if the chat window is not scrolled to the absolute bottom.

**Primary Objective:** Automatically scroll the active `.antigravity-chat-scroll-area` (or equivalent container) to the bottom whenever new DOM nodes (messages) are inserted or modified.

---

## 2. Architecture & Constraints
VS Code extensions run in an isolated `Node.js` Extension Host process. They **cannot** natively access the DOM of the main IDE window or Webviews. As such, the extension must "monkey-patch" the IDE's core HTML file to inject functionality directly into the renderer process.

### The Mechanism
1. **Target:** Locate the Antigravity installation path. Specifically, find `resources/app/out/vs/code/electron-sandbox/workbench/workbench.html`.
2. **Injection:** The extension must append a `<script>` tag referencing our local payload file to `workbench.html` if it does not already exist.
3. **Integrity Suppression:** Modifying `workbench.html` will trigger a core corruption warning from VS Code/Antigravity on startup.
   - Look for `resources/app/product.json`.
   - Update the `checksums["vs/code/electron-sandbox/workbench/workbench.html"]` value to perfectly match the `SHA256` hash of our modified, injected HTML file.
4. **Lifecycle:** When the user reloads the window, the IDE renderer process executes `payload.js`, giving it unrestricted DOM access to the UI.

---

## 3. Implementation Requirements

### Component 1: `extension.ts` (The Installer)
Create a standard VS Code extension that handles the patching lifecycle.
- **`activate()`:** Check if `workbench.html` is patched. If not, back up the original, append the script, recalculate the hash, update `product.json`, and prompt the user to "Reload Window".
- **Safety Checks:** Ensure backups are explicitly created (`workbench.html.bak`). If reading/writing fails due to permissions (very common on Windows standard user accounts), surface a clear error asking the user to run VS Code/Antigravity as Administrator for the initial installation.
- **Uninstaller Command:** Register a command (e.g., `Better-Antigravity: Remove Auto-Scroll Patch`) that restores `workbench.html` from the backup and restores the original checksum within `product.json`.

### Component 2: `payload.js` (The DOM Observer)
The injected script that runs inside the IDE frontend.
- **Identify the Chat Container:** The script must use `document.querySelector` or `document.getElementById` to find the scrollable container housing the Antigravity chat logs. Note: The DOM element may load asynchronously. Use a top-level `MutationObserver` on `document.body` to wait for the chat container to appear.
- **Observe Content:** Attach a new `MutationObserver` specifically targeting the chat container with `{ childList: true, subtree: true, characterData: true }`.
- **Scroll Logic:** Within the observer callback, force the scroll:
  ```javascript
  chatContainer.scrollTop = chatContainer.scrollHeight;
  ```
- **Performance:** Streamed AI text will fire mutations rapidly. The actual scroll assignment **must** be debounced via `requestAnimationFrame` to prevent layout thrashing and high CPU usage.
- **UX Consideration (Optional but highly recommended):** If the user is actively scrolling *up* to read history, detect the manual scroll offset. If they are not near the bottom, temporarily suspend the auto-scroll observer. Resume when they scroll back down.

---

## 4. Acceptance Criteria
1. The extension installs silently (or with minimal prompts) on activation.
2. The user is prompted exactly once to reload the IDE window after the initial patch.
3. Antigravity starts up normally *without* any "corrupt installation" warnings.
4. When prompting the AI in the chat sidepane, the window flawlessly auto-scrolls downward as new tokens/responses stream in.
5. Manually invoking the `Remove Patch` uninstaller successfully reverts the IDE to its clean, pristine state without breaking startup.
