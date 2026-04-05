#!/usr/bin/env node

/**
 * Antigravity Link Approval Auto-Accept Fix
 * ==========================================
 *
 * Automatically accepts all external link opening requests by patching
 * the validateLink method in the OpenerService to return true immediately.
 *
 * Usage:
 *   node patch.js           - Apply patch
 *   node patch.js --revert  - Restore original files
 *   node patch.js --check   - Check patch status
 *   node patch.js --force   - Apply even if AG version is untested
 *
 * Based on work by @jyongchul (PR #23).
 * License: MIT
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Version Gating ─────────────────────────────────────────────────────────

const SUPPORTED_MIN = [1, 107, 0];
const SUPPORTED_MAX = [1, 199, 0];

function parseVersion(str) {
    const parts = (str || '').split('.').map(Number);
    return parts.length === 3 && parts.every(n => Number.isFinite(n)) ? parts : null;
}

function compareVersions(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

function getAgVersions(basePath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'package.json'), 'utf8'));
        const product = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'product.json'), 'utf8'));
        return { appVersion: pkg.version, ideVersion: product.ideVersion };
    } catch { return { appVersion: null, ideVersion: null }; }
}

function checkVersion(basePath) {
    const { appVersion, ideVersion } = getAgVersions(basePath);
    const parsed = parseVersion(appVersion);

    if (!parsed) {
        return { ok: false, version: appVersion || 'unknown', ideVersion,
            reason: 'Could not determine Antigravity version.' };
    }
    if (compareVersions(parsed, SUPPORTED_MIN) < 0) {
        return { ok: false, version: appVersion, ideVersion,
            reason: `Version ${appVersion} is below minimum supported ${SUPPORTED_MIN.join('.')}.` };
    }
    if (compareVersions(parsed, SUPPORTED_MAX) > 0) {
        return { ok: false, version: appVersion, ideVersion,
            reason: `Version ${appVersion} exceeds maximum tested ${SUPPORTED_MAX.join('.')}.` };
    }
    return { ok: true, version: appVersion, ideVersion };
}

function getVersion(basePath) {
    const { appVersion, ideVersion } = getAgVersions(basePath);
    if (appVersion && ideVersion) return `${appVersion} (IDE ${ideVersion})`;
    if (appVersion) return appVersion;
    return 'unknown';
}

// ─── Installation Detection ─────────────────────────────────────────────────

function isAntigravityDir(dir) {
    if (!dir) return false;
    try {
        const workbench = path.join(dir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        return fs.existsSync(workbench);
    } catch { return false; }
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
            } catch { /* key not found */ }
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
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir && dir !== root) {
        if (looksLikeAntigravityRoot(dir) && isAntigravityDir(dir)) return dir;
        dir = path.dirname(dir);
    }

    const fromPath = findFromPath();
    if (fromPath) return fromPath;

    const fromReg = findFromRegistry();
    if (fromReg) return fromReg;

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

// ─── Patching ───────────────────────────────────────────────────────────────

const PATCH_MARKER = '/*BA:link-approval*/';

function patchFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        console.log(`  \u274C [${label}] File not found: ${filePath}`);
        return false;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    if (content.includes(PATCH_MARKER)) {
        console.log(`  \u23ED\uFE0F  [${label}] Already patched`);
        return true;
    }

    // Pattern: async validateLink(e,i){if(!cb(e,Oe.http)...
    // Verified on AG v1.107.0: exactly 1 match in workbench.desktop.main.js
    const validateLinkRe = /async validateLink\((\w+),(\w+)\)\{/;
    const match = content.match(validateLinkRe);

    if (!match) {
        console.log(`  \u274C [${label}] Could not find validateLink method pattern`);
        return false;
    }

    const [fullMatch] = match;
    const patch = `${fullMatch}${PATCH_MARKER}return !0;`;

    // Backup (only if one doesn't exist)
    const bak = filePath + '.ba-backup';
    if (!fs.existsSync(bak)) {
        fs.copyFileSync(filePath, bak);
        console.log(`  \uD83D\uDCE6 [${label}] Backup created`);
    }

    content = content.replace(fullMatch, patch);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  \u2705 [${label}] Patched (links will now auto-accept)`);
    return true;
}

function revertFile(filePath, label) {
    const bak = filePath + '.ba-backup';
    if (!fs.existsSync(bak)) {
        console.log(`  \u23ED\uFE0F  [${label}] No backup, skipping`);
        return;
    }
    fs.copyFileSync(bak, filePath);
    fs.unlinkSync(bak);
    console.log(`  \u2705 [${label}] Restored`);
}

function checkFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        console.log(`  \u274C [${label}] Not found`);
        return false;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const patched = content.includes(PATCH_MARKER);
    const hasBak = fs.existsSync(filePath + '.ba-backup');

    if (patched) {
        console.log(`  \u2705 [${label}] PATCHED` + (hasBak ? ' (backup exists)' : ''));
    } else {
        const match = content.match(/async validateLink\((\w+),(\w+)\)\{/);
        if (match) {
            console.log(`  \u2B1C [${label}] NOT PATCHED (patchable)`);
        } else {
            console.log(`  \u26A0\uFE0F  [${label}] NOT PATCHED (pattern not found)`);
        }
    }
    return patched;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert' : args.includes('--check') ? 'check' : 'apply';
    const force = args.includes('--force');

    let explicitPath = null;
    const pathIdx = args.indexOf('--path');
    if (pathIdx !== -1 && args[pathIdx + 1]) {
        explicitPath = path.resolve(args[pathIdx + 1]);
    }

    console.log('');
    console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
    console.log('\u2551  Antigravity Link Approval Auto-Accept Fix      \u2551');
    console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D');

    let basePath;
    if (explicitPath) {
        if (!isAntigravityDir(explicitPath)) {
            console.log(`\n\u274C --path "${explicitPath}" does not look like an Antigravity installation.`);
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
        console.log('     1. Run from the Antigravity install directory');
        console.log('     2. npx better-antigravity link-approval --path "D:\\Antigravity"');
        process.exit(1);
    }

    console.log(`\n\uD83D\uDCCD ${basePath}`);
    console.log(`\uD83D\uDCE6 Version: ${getVersion(basePath)}`);

    // Version gate (apply only)
    if (action === 'apply') {
        const vc = checkVersion(basePath);
        if (!vc.ok) {
            console.log(`\n\u26D4 ${vc.reason}`);
            console.log(`   Supported range: ${SUPPORTED_MIN.join('.')} \u2013 ${SUPPORTED_MAX.join('.')}`);
            if (force) {
                console.log('   \u26A0\uFE0F  --force specified, proceeding anyway...');
            } else {
                console.log('   Use --force to override (at your own risk).');
                process.exit(1);
            }
        }
    }

    console.log('');

    // Only workbench has validateLink (verified: jetskiAgent does NOT)
    const workbenchPath = path.join(basePath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');

    switch (action) {
        case 'check':
            checkFile(workbenchPath, 'workbench');
            break;
        case 'revert':
            revertFile(workbenchPath, 'workbench');
            console.log('\n\u2728 Restored! Restart Antigravity.');
            break;
        case 'apply':
            const ok = patchFile(workbenchPath, 'workbench');
            console.log(ok
                ? '\n\u2728 Done! Restart Antigravity.\n\uD83D\uDCA1 Run with --revert to undo.\n\u26A0\uFE0F  Re-run after Antigravity updates.'
                : '\n\u26A0\uFE0F  Patch failed.');
            break;
    }
}

main();
