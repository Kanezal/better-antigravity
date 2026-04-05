#!/usr/bin/env node

/**
 * Antigravity "Always Proceed" Auto-Run Fix
 * ==========================================
 * 
 * Fixes a bug where the "Always Proceed" terminal execution policy doesn't
 * actually auto-execute commands. Uses regex patterns to find code structures
 * regardless of minified variable names — works across versions.
 * 
 * Usage:
 *   node patch.js           - Apply patch
 *   node patch.js --revert  - Restore original files
 *   node patch.js --check   - Check patch status
 *   node patch.js --force   - Apply even if AG version is untested
 * 
 * License: MIT
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Version Gating ─────────────────────────────────────────────────────────

/**
 * Supported AG app version range (from resources/app/package.json).
 * Patch is tested on these versions; outside this range it may brick the IDE.
 */
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

/**
 * Check if the AG version is within the supported range.
 * Returns { ok, version, reason } — reason is set only when ok=false.
 */
function checkVersion(basePath) {
    const { appVersion, ideVersion } = getAgVersions(basePath);
    const parsed = parseVersion(appVersion);

    if (!parsed) {
        return { ok: false, version: appVersion || 'unknown', ideVersion,
            reason: 'Could not determine Antigravity version.' };
    }

    if (compareVersions(parsed, SUPPORTED_MIN) < 0) {
        return { ok: false, version: appVersion, ideVersion,
            reason: `Version ${appVersion} is below minimum supported ${SUPPORTED_MIN.join('.')}. Patch patterns may not match.` };
    }

    if (compareVersions(parsed, SUPPORTED_MAX) > 0) {
        return { ok: false, version: appVersion, ideVersion,
            reason: `Version ${appVersion} exceeds maximum tested ${SUPPORTED_MAX.join('.')}. Patch may produce invalid JS.` };
    }

    return { ok: true, version: appVersion, ideVersion };
}

// ─── Installation Detection ─────────────────────────────────────────────────

/**
 * Validates that a candidate directory is a real Antigravity installation
 * by checking for the workbench main JS file.
 */
function isAntigravityDir(dir) {
    if (!dir) return false;
    try {
        const workbench = path.join(dir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        return fs.existsSync(workbench);
    } catch { return false; }
}

/**
 * Checks if a directory looks like the Antigravity installation root
 * (contains Antigravity.exe or antigravity binary).
 */
function looksLikeAntigravityRoot(dir) {
    if (!dir) return false;
    try {
        const exe = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';
        return fs.existsSync(path.join(dir, exe));
    } catch { return false; }
}

/**
 * Tries to find Antigravity installation path from Windows Registry.
 * InnoSetup writes uninstall info to HKCU or HKLM.
 */
function findFromRegistry() {
    if (process.platform !== 'win32') return null;
    try {
        const { execSync } = require('child_process');
        // InnoSetup typically writes to this key; try HKCU first, then HKLM
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

/**
 * Tries to find Antigravity by looking at PATH entries for the executable.
 */
function findFromPath() {
    try {
        const pathDirs = (process.env.PATH || '').split(path.delimiter);
        const exe = process.platform === 'win32' ? 'Antigravity.exe' : 'antigravity';
        for (const dir of pathDirs) {
            if (!dir) continue;
            if (fs.existsSync(path.join(dir, exe))) {
                // The exe could be in the root or in a bin/ subdirectory
                if (isAntigravityDir(dir)) return dir;
                const parent = path.dirname(dir);
                if (isAntigravityDir(parent)) return parent;
            }
        }
    } catch { /* PATH parsing failed */ }
    return null;
}

function findAntigravityPath() {
    // 1. Check CWD and its ancestors (user may run from install dir or a subdir)
    let dir = process.cwd();
    const root = path.parse(dir).root;
    while (dir && dir !== root) {
        if (looksLikeAntigravityRoot(dir) && isAntigravityDir(dir)) return dir;
        dir = path.dirname(dir);
    }

    // 2. Check PATH
    const fromPath = findFromPath();
    if (fromPath) return fromPath;

    // 3. Check Windows Registry (InnoSetup uninstall keys)
    const fromReg = findFromRegistry();
    if (fromReg) return fromReg;

    // 4. Hardcoded well-known locations
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

// ─── Smart Pattern Matching ─────────────────────────────────────────────────

const PATCH_MARKER = '/*BA:autorun*/';

/**
 * Find the useEffect alias using a three-phase strategy.
 *
 * Phase 1 (declaration): `useEffect:()=>fn` in export tables — most reliable.
 * Phase 2 (cleanup-return): only useEffect returns a cleanup `()=>`.
 * Phase 3 (frequency): most-called `fn(()=>{` in context — last resort.
 */
function findUseEffect(fullContent, context, exclude) {
    // Phase 1: declaration in export/re-export table
    const declMatch = fullContent.match(/useEffect:\(\)=>(\w+)/);
    if (declMatch) return declMatch[1];

    // Phase 2: cleanup-return — only useEffect returns () =>
    const cleanupCandidates = {};
    const cleanupRe = /\b(\w{1,4})\(\(\)=>\{[\s\S]{1,500}?return\s*\(\)=>/g;
    let m;
    while ((m = cleanupRe.exec(context)) !== null) {
        const fn = m[1];
        if (!exclude.includes(fn) && !/^(var|let|for|new|if)$/.test(fn)) {
            cleanupCandidates[fn] = (cleanupCandidates[fn] || 0) + 1;
        }
    }
    const cleanupBest = Object.entries(cleanupCandidates).sort((a, b) => b[1] - a[1])[0];
    if (cleanupBest) return cleanupBest[0];

    // Phase 3: frequency analysis
    const candidates = {};
    const freqRe = /\b(\w{1,4})\(\(\)=>\{/g;
    while ((m = freqRe.exec(context)) !== null) {
        const fn = m[1];
        if (!exclude.includes(fn) && !/^(var|let|for|new|if)$/.test(fn)) {
            candidates[fn] = (candidates[fn] || 0) + 1;
        }
    }
    const freqBest = Object.entries(candidates).sort((a, b) => b[1] - a[1])[0];
    return freqBest ? freqBest[0] : null;
}

/**
 * Finds the onChange handler for terminalAutoExecutionPolicy and extracts
 * all variable names needed to build the patch.
 *
 * AG v1.107+ pattern (optional chaining, no parens on single arg):
 *   onChange = useCallback(arg => {
 *     ref?.setTerminalAutoExecutionPolicy?.(arg),
 *     arg === ENUM.EAGER && confirmFn(!0)
 *   }, [ref, confirmFn])
 */
function analyzeFile(content, label) {
    // 1. Find onChange handler
    const onChangeRe = /(\w+)=(\w+)\((\w+)=>\{(\w+)\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===(\w+)\.EAGER&&(\w+)\(!0\)\},\[/g;
    const onChangeMatch = onChangeRe.exec(content);

    if (!onChangeMatch) {
        if (label !== 'jetskiAgent-legacy') {
            console.log(`  ❌ [${label}] Could not find onChange handler pattern`);
        }
        return null;
    }

    const [fullMatch, , , , , enumAlias, confirmFn] = onChangeMatch;
    const matchIndex = onChangeMatch.index;
    const insertPos = matchIndex + fullMatch.length;

    console.log(`  📋 [${label}] Found onChange at offset ${matchIndex}`);
    console.log(`     enum=${enumAlias}, confirm=${confirmFn}`);

    const contextStart = Math.max(0, matchIndex - 3000);
    const contextEnd = Math.min(content.length, matchIndex + 3000);
    const context = content.substring(contextStart, contextEnd);

    // 2. Find policy variable: VARNAME=HANDLER?.terminalAutoExecutionPolicy??ENUM.OFF
    const policyMatch = /(\w+)=\w+\?\.terminalAutoExecutionPolicy\?\?(\w+)\.OFF/.exec(context);
    if (!policyMatch) {
        console.log(`  ❌ [${label}] Could not find policy variable`);
        return null;
    }
    const policyVar = policyMatch[1];
    console.log(`     policyVar=${policyVar}`);

    // 3. Find secureMode variable: VARNAME=HANDLER?.secureModeEnabled??!1
    const secureMatch = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/.exec(context);
    if (!secureMatch) {
        console.log(`  ❌ [${label}] Could not find secureMode variable`);
        return null;
    }
    const secureVar = secureMatch[1];
    console.log(`     secureVar=${secureVar}`);

    // 4. Find useEffect alias (3-phase)
    const useEffectAlias = findUseEffect(content, context, [confirmFn]);
    if (!useEffectAlias) {
        console.log(`  ❌ [${label}] Could not determine useEffect alias`);
        return null;
    }
    console.log(`     useEffect=${useEffectAlias}`);

    // 5. Insertion point: AFTER the `;` that terminates the let/var chain
    //    In v1.21.6+ the minifier comma-chains ALL declarations into one `let`,
    //    so the terminating `;` is hundreds of chars after the onChange `])`.
    //    We must insert AFTER that `;` (between the let statement and `return`).
    //    In older versions where each declaration ends with its own `;`, the
    //    first `;` is right after `])` — same logic works in both cases.
    const afterOnChange = content.indexOf('])', insertPos);
    if (afterOnChange === -1) return null;
    const chainSemicolon = content.indexOf(';', afterOnChange);
    if (chainSemicolon === -1) return null;
    const insertAt = chainSemicolon + 1; // insert AFTER the ;

    return { enumAlias, confirmFn, policyVar, secureVar, useEffectAlias, insertAt };
}

// ─── File Operations ────────────────────────────────────────────────────────

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

    const analysis = analyzeFile(content, label);
    if (!analysis) {
        if (label === 'jetskiAgent-legacy') {
            console.log(`  ⏭️  [${label}] Skipped — bootstrap stub (jetskiAgent moved to out/jetskiAgent/main.js)`);
            return true;
        }
        return false;
    }

    const { enumAlias, confirmFn, policyVar, secureVar, useEffectAlias, insertAt } = analysis;
    const patch = `${PATCH_MARKER}${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]);`;

    // Backup (only if one doesn't exist)
    const bak = filePath + '.ba-backup';
    if (!fs.existsSync(bak)) {
        fs.copyFileSync(filePath, bak);
        console.log(`  📦 [${label}] Backup created`);
    }

    content = content.substring(0, insertAt) + patch + content.substring(insertAt);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✅ [${label}] Patched (+${patch.length} bytes)`);
    return true;
}

function revertFile(filePath, label) {
    const bak = filePath + '.ba-backup';
    if (!fs.existsSync(bak)) {
        console.log(`  ⏭️  [${label}] No backup, skipping`);
        return;
    }
    fs.copyFileSync(bak, filePath);
    fs.unlinkSync(bak);
    console.log(`  ✅ [${label}] Restored`);
}

function checkFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        console.log(`  ❌ [${label}] Not found`);
        return false;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const patched = content.includes(PATCH_MARKER);
    const hasBak = fs.existsSync(filePath + '.ba-backup');

    if (patched) {
        console.log(`  ✅ [${label}] PATCHED` + (hasBak ? ' (backup exists)' : ''));
    } else {
        const analysis = analyzeFile(content, label);
        if (analysis) {
            console.log(`  ⬜ [${label}] NOT PATCHED (patchable)`);
        } else if (label === 'jetskiAgent-legacy') {
            console.log(`  ⏭️  [${label}] Skipped — bootstrap stub (jetskiAgent moved to out/jetskiAgent/main.js)`);
        } else {
            console.log(`  ⚠️  [${label}] NOT PATCHED (pattern not found — may be incompatible or already fixed by AG)`);
        }
    }
    return patched;
}

// ─── Version Info ───────────────────────────────────────────────────────────

function getVersion(basePath) {
    const { appVersion, ideVersion } = getAgVersions(basePath);
    if (appVersion && ideVersion) return `${appVersion} (IDE ${ideVersion})`;
    if (appVersion) return appVersion;
    return 'unknown';
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert' : args.includes('--check') ? 'check' : 'apply';
    const force = args.includes('--force');

    // Parse --path flag
    let explicitPath = null;
    const pathIdx = args.indexOf('--path');
    if (pathIdx !== -1 && args[pathIdx + 1]) {
        explicitPath = path.resolve(args[pathIdx + 1]);
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Antigravity "Always Proceed" Auto-Run Fix      ║');
    console.log('╚══════════════════════════════════════════════════╝');

    let basePath;
    if (explicitPath) {
        if (!isAntigravityDir(explicitPath)) {
            console.log(`\n\u274C --path "${explicitPath}" does not look like an Antigravity installation.`);
            console.log('   Expected to find: resources/app/out/vs/workbench/workbench.desktop.main.js');
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
        console.log('        cd "C:\\Path\\To\\Antigravity" && npx better-antigravity auto-run');
        console.log('     2. Specify the path explicitly:');
        console.log('        npx better-antigravity auto-run --path "D:\\Antigravity"');
        process.exit(1);
    }

    console.log(`\n📍 ${basePath}`);
    console.log(`📦 Version: ${getVersion(basePath)}`);

    // Version gate: block patching on untested AG versions
    if (action === 'apply') {
        const vc = checkVersion(basePath);
        if (!vc.ok) {
            console.log(`\n⛔ ${vc.reason}`);
            console.log(`   Supported range: ${SUPPORTED_MIN.join('.')} – ${SUPPORTED_MAX.join('.')}`);
            if (force) {
                console.log('   ⚠️  --force specified, proceeding anyway...');
            } else {
                console.log('   Use --force to override (at your own risk).');
                process.exit(1);
            }
        }
    }

    console.log('');

    const files = [
        { path: path.join(basePath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js'), label: 'workbench' },
        { path: path.join(basePath, 'resources', 'app', 'out', 'jetskiAgent', 'main.js'), label: 'jetskiAgent' },
        { path: path.join(basePath, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'jetskiAgent.js'), label: 'jetskiAgent-legacy' },
    ].filter(f => fs.existsSync(f.path));

    switch (action) {
        case 'check':
            files.forEach(f => checkFile(f.path, f.label));
            break;
        case 'revert':
            files.forEach(f => revertFile(f.path, f.label));
            console.log('\n✨ Restored! Restart Antigravity.');
            break;
        case 'apply':
            const ok = files.every(f => patchFile(f.path, f.label));
            console.log(ok
                ? '\n✨ Done! Restart Antigravity.\n💡 Run with --revert to undo.\n⚠️  Re-run after Antigravity updates.'
                : '\n⚠️  Some patches failed.');
            break;
    }
}

main();
