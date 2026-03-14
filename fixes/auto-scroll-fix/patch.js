#!/usr/bin/env node

/**
 * Antigravity Auto-Scroll Fix
 * ============================
 * 
 * Patches workbench.html to inject an auto-scroll payload that keeps the
 * chat window pinned to the bottom during AI generation. Also updates
 * product.json checksums to suppress integrity warnings.
 * 
 * Uses structural DOM matching (looks for </html> closing tag) rather
 * than hardcoded variable names — works across Antigravity versions.
 * 
 * Usage:
 *   node patch.js          - Apply patch
 *   node patch.js --revert - Restore original files
 *   node patch.js --check  - Check patch status
 * 
 * License: AGPL-3.0-or-later
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ─── Patch Marker ───────────────────────────────────────────────────────────

const PATCH_MARKER = '<!-- BA: Auto-Scroller Payload -->';

// ─── Payload (embedded) ────────────────────────────────────────────────────
// The payload is loaded from static/payload.js relative to the package root.
// When run via CLI (npx), the package root is __dirname/../../.
// When run directly, we also check __dirname.

function findPayloadPath() {
    const candidates = [
        path.join(__dirname, '..', '..', 'static', 'payload.js'),  // from fixes/auto-scroll-fix/
        path.join(__dirname, 'payload.js'),                         // if copied alongside
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// ─── Installation Detection ─────────────────────────────────────────────────
// Shared logic with auto-run-fix, adapted for workbench.html detection.

/**
 * Validates that a candidate directory is a real Antigravity installation
 * by checking for the workbench HTML file in known locations.
 */
function isAntigravityDir(dir) {
    if (!dir) return false;
    try {
        return getWorkbenchHtmlPath(dir) !== null;
    } catch { return false; }
}

/**
 * Finds workbench.html in an Antigravity installation. Checks both
 * electron-browser and electron-sandbox paths for version resilience.
 */
function getWorkbenchHtmlPath(baseDir) {
    const appDir = path.join(baseDir, 'resources', 'app');
    const candidates = [
        path.join(appDir, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appDir, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Returns the checksums key for a given workbench.html path,
 * relative to the app directory.
 */
function getChecksumKey(workbenchPath, baseDir) {
    const appDir = path.join(baseDir, 'resources', 'app');
    return path.relative(appDir, workbenchPath).replace(/\\/g, '/');
}

function looksLikeAntigravityRoot(dir) {
    if (!dir) return false;
    try {
        const exe = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';
        return fs.existsSync(path.join(dir, exe));
    } catch { return false; }
}

function findFromRegistry() {
    if (process.platform !== 'win32') return null;
    try {
        const { execSync } = require('child_process');
        const regPaths = [
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Antigravity_is1',
            'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Antigravity_is1',
            'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Antigravity_is1',
        ];
        for (const regPath of regPaths) {
            try {
                const output = execSync(
                    `reg query "${regPath}" /v InstallLocation`,
                    { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
                );
                const match = output.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
                if (match) {
                    const dir = match[1].trim().replace(/\\$/, '');
                    if (isAntigravityDir(dir)) return dir;
                }
            } catch { /* key not found, try next */ }
        }
    } catch { /* child_process failed */ }
    return null;
}

function findFromPath() {
    try {
        const pathDirs = (process.env.PATH || '').split(path.delimiter);
        const exe = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';
        for (const dir of pathDirs) {
            if (!dir) continue;
            if (fs.existsSync(path.join(dir, exe))) {
                if (isAntigravityDir(dir)) return dir;
                const parent = path.dirname(dir);
                if (isAntigravityDir(parent)) return parent;
            }
        }
    } catch { /* PATH parsing failed */ }
    return null;
}

function findAntigravityPath() {
    // 1. CWD ancestors
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir && dir !== root) {
        if (looksLikeAntigravityRoot(dir) && isAntigravityDir(dir)) return dir;
        dir = path.dirname(dir);
    }

    // 2. PATH
    const fromPath = findFromPath();
    if (fromPath) return fromPath;

    // 3. Windows Registry
    const fromReg = findFromRegistry();
    if (fromReg) return fromReg;

    // 4. Well-known locations
    const candidates = [];
    if (process.platform === 'win32') {
        candidates.push(
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity'),
            path.join(process.env.PROGRAMFILES || '', 'Antigravity'),
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Antigravity.app/Contents/Resources',
            path.join(os.homedir(), 'Applications', 'Antigravity.app', 'Contents', 'Resources')
        );
    } else {
        candidates.push('/usr/share/antigravity', '/opt/antigravity',
            path.join(os.homedir(), '.local', 'share', 'antigravity'));
    }
    for (const c of candidates) {
        if (isAntigravityDir(c)) return c;
    }

    return null;
}

// ─── Checksum ───────────────────────────────────────────────────────────────

function computeChecksum(content) {
    return crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
}

// ─── Version Info ───────────────────────────────────────────────────────────

function getVersion(basePath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'package.json'), 'utf8'));
        const product = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'product.json'), 'utf8'));
        return `${pkg.version} (IDE ${product.ideVersion})`;
    } catch { return 'unknown'; }
}

// ─── Payload Injection ──────────────────────────────────────────────────────

/**
 * Builds the script tag that will be injected into workbench.html.
 * The payload is copied to a deterministic location next to workbench.html
 * so the <script src> resolves at runtime in the Electron renderer.
 */
function deployPayload(workbenchHtmlPath, payloadSourcePath) {
    const workbenchDir = path.dirname(workbenchHtmlPath);
    const destPath = path.join(workbenchDir, 'ba-auto-scroll-payload.js');
    fs.copyFileSync(payloadSourcePath, destPath);
    // Use relative path so it resolves in the Electron file:// context
    return 'ba-auto-scroll-payload.js';
}

// ─── Patch Operations ───────────────────────────────────────────────────────

function applyPatch(basePath) {
    const workbenchPath = getWorkbenchHtmlPath(basePath);
    if (!workbenchPath) {
        console.log('  ❌ workbench.html not found');
        return false;
    }

    const content = fs.readFileSync(workbenchPath, 'utf8');

    // Check if already patched
    if (content.includes(PATCH_MARKER)) {
        console.log('  ⏭️  Already patched');
        return true;
    }

    // Structural match: find </html> closing tag
    if (!content.includes('</html>')) {
        console.log('  ❌ Could not find </html> in workbench.html (unexpected structure)');
        return false;
    }

    // Find and deploy payload
    const payloadPath = findPayloadPath();
    if (!payloadPath) {
        console.log('  ❌ payload.js not found');
        console.log('     Expected at: static/payload.js relative to package root');
        return false;
    }

    const payloadRelativeSrc = deployPayload(workbenchPath, payloadPath);

    // Backup workbench.html
    const workbenchBak = workbenchPath + '.ba-backup';
    if (!fs.existsSync(workbenchBak)) {
        fs.copyFileSync(workbenchPath, workbenchBak);
        console.log('  📦 workbench.html backup created');
    }

    // Inject script tag before </html>
    const scriptTag = `\n\t${PATCH_MARKER}\n\t<script src="${payloadRelativeSrc}"></script>\n`;
    const patched = content.replace('</html>', `${scriptTag}</html>`);
    const patchedBuffer = Buffer.from(patched, 'utf8');
    fs.writeFileSync(workbenchPath, patchedBuffer);
    console.log(`  ✅ workbench.html patched (+${patchedBuffer.length - Buffer.byteLength(content)} bytes)`);

    // Update product.json checksum
    const productPath = path.join(basePath, 'resources', 'app', 'product.json');
    if (fs.existsSync(productPath)) {
        const productBak = productPath + '.ba-scroll-backup';
        const productStr = fs.readFileSync(productPath, 'utf8');

        if (!fs.existsSync(productBak)) {
            fs.writeFileSync(productBak, productStr, 'utf8');
            console.log('  📦 product.json backup created');
        }

        const productJson = JSON.parse(productStr);
        if (!productJson.checksums) {
            productJson.checksums = {};
        }

        const checksumKey = getChecksumKey(workbenchPath, basePath);
        productJson.checksums[checksumKey] = computeChecksum(patchedBuffer);
        fs.writeFileSync(productPath, JSON.stringify(productJson, null, '\t'), 'utf8');
        console.log(`  ✅ product.json checksum updated (${checksumKey})`);
    }

    return true;
}

function revertPatch(basePath) {
    const workbenchPath = getWorkbenchHtmlPath(basePath);
    if (!workbenchPath) {
        console.log('  ⏭️  workbench.html not found, skipping');
        return;
    }

    let restored = false;

    // Restore workbench.html
    const workbenchBak = workbenchPath + '.ba-backup';
    if (fs.existsSync(workbenchBak)) {
        fs.copyFileSync(workbenchBak, workbenchPath);
        fs.unlinkSync(workbenchBak);
        console.log('  ✅ workbench.html restored');
        restored = true;
    } else {
        console.log('  ⏭️  No workbench.html backup found');
    }

    // Clean up deployed payload
    const deployedPayload = path.join(path.dirname(workbenchPath), 'ba-auto-scroll-payload.js');
    if (fs.existsSync(deployedPayload)) {
        fs.unlinkSync(deployedPayload);
        console.log('  ✅ Deployed payload removed');
    }

    // Restore product.json
    const productPath = path.join(basePath, 'resources', 'app', 'product.json');
    const productBak = productPath + '.ba-scroll-backup';
    if (fs.existsSync(productBak)) {
        fs.copyFileSync(productBak, productPath);
        fs.unlinkSync(productBak);
        console.log('  ✅ product.json restored');
        restored = true;
    } else {
        console.log('  ⏭️  No product.json backup found');
    }

    if (restored) {
        console.log('\n✨ Restored! Restart Antigravity.');
    } else {
        console.log('\n⚠️  Nothing to restore.');
    }
}

function checkPatch(basePath) {
    const workbenchPath = getWorkbenchHtmlPath(basePath);
    if (!workbenchPath) {
        console.log('  ❌ workbench.html not found');
        return false;
    }

    const content = fs.readFileSync(workbenchPath, 'utf8');
    const patched = content.includes(PATCH_MARKER);
    const hasBak = fs.existsSync(workbenchPath + '.ba-backup');

    // Check deployed payload exists
    const deployedPayload = path.join(path.dirname(workbenchPath), 'ba-auto-scroll-payload.js');
    const hasPayload = fs.existsSync(deployedPayload);

    if (patched) {
        console.log(`  ✅ PATCHED` + (hasBak ? ' (backup exists)' : '') + (hasPayload ? ' (payload deployed)' : ' ⚠️  payload missing!'));
    } else {
        if (content.includes('</html>')) {
            console.log('  ⬜ NOT PATCHED (patchable)');
        } else {
            console.log('  ⚠️  NOT PATCHED (unexpected HTML structure)');
        }
    }

    return patched;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert' : args.includes('--check') ? 'check' : 'apply';

    // Parse --path flag
    let explicitPath = null;
    const pathIdx = args.indexOf('--path');
    if (pathIdx !== -1 && args[pathIdx + 1]) {
        explicitPath = path.resolve(args[pathIdx + 1]);
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Antigravity Auto-Scroll Fix                    ║');
    console.log('╚══════════════════════════════════════════════════╝');

    let basePath;
    if (explicitPath) {
        if (!isAntigravityDir(explicitPath)) {
            console.log(`\n\u274C --path "${explicitPath}" does not look like an Antigravity installation.`);
            console.log('   Expected to find: workbench.html in resources/app/out/vs/code/');
            process.exit(1);
        }
        basePath = explicitPath;
    } else {
        basePath = findAntigravityPath();
    }

    if (!basePath) {
        console.log('\n\u274C Antigravity installation not found!');
        console.log('');
        console.log('   Try one of:');
        console.log('     1. Run from the Antigravity install directory:');
        console.log('        cd "C:\\Path\\To\\Antigravity" && npx better-antigravity auto-scroll');
        console.log('     2. Specify the path explicitly:');
        console.log('        npx better-antigravity auto-scroll --path "D:\\Antigravity"');
        process.exit(1);
    }

    console.log(`\n📍 ${basePath}`);
    console.log(`📦 Version: ${getVersion(basePath)}`);
    console.log('');

    switch (action) {
        case 'check':
            checkPatch(basePath);
            break;
        case 'revert':
            revertPatch(basePath);
            break;
        case 'apply':
            const ok = applyPatch(basePath);
            console.log(ok
                ? '\n✨ Done! Restart Antigravity.\n💡 Run with --revert to undo.\n⚠️  Re-run after Antigravity updates.'
                : '\n⚠️  Patch failed.');
            break;
    }
}

main();
