#!/usr/bin/env node

/**
 * Antigravity Link Approval Auto-Accept Fix
 * ==========================================
 * 
 * Automatically accepts all external link opening requests by patching
 * the validateLink method in the OpenerService.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Installation Detection ─────────────────────────────────────────────────

function isAntigravityDir(dir) {
    if (!dir) return false;
    try {
        const workbench = path.join(dir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        return fs.existsSync(workbench);
    } catch { return false; }
}

function findAntigravityPath() {
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir && dir !== root) {
        if (isAntigravityDir(dir)) return dir;
        dir = path.dirname(dir);
    }
    const candidates = [];
    if (process.platform === 'win32') {
        candidates.push(
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity'),
            path.join(process.env.PROGRAMFILES || '', 'Antigravity'),
        );
    } else if (process.platform === 'darwin') {
        candidates.push('/Applications/Antigravity.app/Contents/Resources');
    } else {
        candidates.push('/usr/share/antigravity', '/opt/antigravity');
    }
    for (const c of candidates) {
        if (isAntigravityDir(c)) return c;
    }
    return null;
}

// ─── Smart Pattern Matching ─────────────────────────────────────────────────

const PATCH_MARKER = '/*BA:link-approval*/';

function patchFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        console.log(`  ❌ [${label}] File not found: ${filePath}`);
        return false;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    if (content.includes(PATCH_MARKER)) {
        console.log(`  ⏭️  [${label}] Already patched`);
        return true;
    }

    // Pattern: async validateLink(e,i){if(!cb(e,Oe.http)...
    const validateLinkRe = /async validateLink\((\w+),(\w+)\)\{/;
    const match = content.match(validateLinkRe);

    if (!match) {
        console.log(`  ❌ [${label}] Could not find validateLink method pattern`);
        return false;
    }

    const [fullMatch] = match;
    const patch = `${fullMatch}${PATCH_MARKER}return !0;`;

    // Backup
    const bak = filePath + '.ba-backup';
    if (!fs.existsSync(bak)) {
        fs.copyFileSync(filePath, bak);
        console.log(`  📦 [${label}] Backup created`);
    }

    content = content.replace(fullMatch, patch);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✅ [${label}] Patched (Links will now auto-accept)`);
    return true;
}

function revertFile(filePath, label) {
    const bak = filePath + '.ba-backup';
    if (!fs.existsSync(bak)) {
        console.log(`  ⏭️  [${label}] No backup, skipping`);
        return;
    }
    fs.copyFileSync(bak, filePath);
    // Don't delete backup if it might be shared with other patches, 
    // but here we assume it's safe or we just overwrite it anyway.
    console.log(`  ✅ [${label}] Restored`);
}

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert' : args.includes('--check') ? 'check' : 'apply';

    let explicitPath = null;
    const pathIdx = args.indexOf('--path');
    if (pathIdx !== -1 && args[pathIdx + 1]) {
        explicitPath = path.resolve(args[pathIdx + 1]);
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Antigravity Link Approval Auto-Accept Fix      ║');
    console.log('╚══════════════════════════════════════════════════╝');

    let basePath = explicitPath || findAntigravityPath();
    if (!basePath) {
        console.log('\n❌ Antigravity installation not found!');
        process.exit(1);
    }

    const workbenchPath = path.join(basePath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');

    if (action === 'revert') {
        revertFile(workbenchPath, 'workbench');
    } else {
        patchFile(workbenchPath, 'workbench');
    }
}

main();
