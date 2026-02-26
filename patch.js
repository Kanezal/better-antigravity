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
 *   node patch.js          - Apply patch
 *   node patch.js --revert - Restore original files
 *   node patch.js --check  - Check patch status
 * 
 * License: MIT
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Installation Detection ─────────────────────────────────────────────────

function findAntigravityPath() {
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
        const f = path.join(c, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        if (fs.existsSync(f)) return c;
    }
    return null;
}

// ─── Smart Pattern Matching ─────────────────────────────────────────────────

/**
 * Finds the onChange handler for terminalAutoExecutionPolicy and extracts
 * variable names from context, regardless of minification.
 * 
 * Pattern we're looking for (structure, not exact names):
 *   <VAR_CONFIRM>=<useCallback>((<ARG>)=>{
 *       <stepHandler>?.setTerminalAutoExecutionPolicy?.(<ARG>),
 *       <ARG>===<ENUM>.EAGER&&<CONFIRM_FN>(!0)
 *   },[...])
 * 
 * From the surrounding context we also extract:
 *   <POLICY_VAR> = <stepHandler>?.terminalAutoExecutionPolicy ?? <ENUM>.OFF
 *   <SECURE_VAR> = <stepHandler>?.secureModeEnabled ?? !1
 */
function analyzeFile(content, label) {
    // 1. Find the onChange handler: contains setTerminalAutoExecutionPolicy AND .EAGER
    //    Pattern: VARNAME=CALLBACK(ARG=>{...setTerminalAutoExecutionPolicy...,ARG===ENUM.EAGER&&CONFIRM(!0)},[...])
    const onChangeRe = /(\w+)=(\w+)\((\w+)=>\{\w+\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===(\w+)\.EAGER&&(\w+)\(!0\)\},\[[\w,]*\]\)/;
    const onChangeMatch = content.match(onChangeRe);

    if (!onChangeMatch) {
        console.log(`  ❌ [${label}] Could not find onChange handler pattern`);
        return null;
    }

    const [fullMatch, assignVar, callbackAlias, argName, enumAlias, confirmFn] = onChangeMatch;
    const matchIndex = content.indexOf(fullMatch);

    console.log(`  📋 [${label}] Found onChange at offset ${matchIndex}`);
    console.log(`     callback=${callbackAlias}, enum=${enumAlias}, confirm=${confirmFn}`);

    // 2. Find policy variable: VARNAME=HANDLER?.terminalAutoExecutionPolicy??ENUM.OFF
    const policyRe = new RegExp(`(\\w+)=\\w+\\?\\.terminalAutoExecutionPolicy\\?\\?${enumAlias}\\.OFF`);
    const policyMatch = content.substring(Math.max(0, matchIndex - 2000), matchIndex).match(policyRe);

    if (!policyMatch) {
        console.log(`  ❌ [${label}] Could not find policy variable`);
        return null;
    }
    const policyVar = policyMatch[1];
    console.log(`     policyVar=${policyVar}`);

    // 3. Find secureMode variable: VARNAME=HANDLER?.secureModeEnabled??!1
    const secureRe = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/;
    const secureMatch = content.substring(Math.max(0, matchIndex - 2000), matchIndex).match(secureRe);

    if (!secureMatch) {
        console.log(`  ❌ [${label}] Could not find secureMode variable`);
        return null;
    }
    const secureVar = secureMatch[1];
    console.log(`     secureVar=${secureVar}`);

    // 4. Find useEffect alias: look for ALIAS(()=>{...},[...]) calls nearby (not useCallback/useMemo)
    const nearbyCode = content.substring(Math.max(0, matchIndex - 5000), matchIndex + 5000);
    const effectCandidates = {};
    const effectRe = /\b(\w{2,3})\(\(\)=>\{[^}]{3,80}\},\[/g;
    let m;
    while ((m = effectRe.exec(nearbyCode)) !== null) {
        const alias = m[1];
        if (alias !== callbackAlias && alias !== 'var' && alias !== 'new') {
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 1;
        }
    }

    // Also check broader file for common useEffect patterns (with cleanup return)
    const cleanupRe = /\b(\w{2,3})\(\(\)=>\{[^}]*return\s*\(\)=>/g;
    while ((m = cleanupRe.exec(content)) !== null) {
        const alias = m[1];
        if (alias !== callbackAlias) {
            effectCandidates[alias] = (effectCandidates[alias] || 0) + 5; // higher weight
        }
    }

    // Remove known non-useEffect aliases (useMemo patterns)
    // useMemo: alias(()=>EXPRESSION,[deps]) — returns a value, often assigned
    // useEffect: alias(()=>{STATEMENTS},[deps]) — no return value

    // Pick the most common candidate
    let useEffectAlias = null;
    let maxCount = 0;
    for (const [alias, count] of Object.entries(effectCandidates)) {
        if (count > maxCount) {
            maxCount = count;
            useEffectAlias = alias;
        }
    }

    if (!useEffectAlias) {
        console.log(`  ❌ [${label}] Could not determine useEffect alias`);
        return null;
    }
    console.log(`     useEffect=${useEffectAlias} (confidence: ${maxCount} hits)`);

    // 5. Build patch
    const patchCode = `_aep=${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]),`;

    return {
        target: fullMatch,
        replacement: patchCode + fullMatch,
        patchMarker: `_aep=${useEffectAlias}(()=>{${policyVar}===${enumAlias}.EAGER`,
        label
    };
}

// ─── File Operations ────────────────────────────────────────────────────────

function patchFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        console.log(`  ❌ [${label}] File not found: ${filePath}`);
        return false;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    // Check if already patched
    if (content.includes('_aep=')) {
        const existingPatch = content.match(/_aep=\w+\(\(\)=>\{[^}]+EAGER[^}]+\},\[\]\)/);
        if (existingPatch) {
            console.log(`  ⏭️  [${label}] Already patched`);
            return true;
        }
    }

    const analysis = analyzeFile(content, label);
    if (!analysis) return false;

    // Verify target is unique
    const count = content.split(analysis.target).length - 1;
    if (count !== 1) {
        console.log(`  ❌ [${label}] Target found ${count} times (expected 1)`);
        return false;
    }

    // Backup
    if (!fs.existsSync(filePath + '.bak')) {
        fs.copyFileSync(filePath, filePath + '.bak');
        console.log(`  📦 [${label}] Backup created`);
    }

    // Apply
    const patched = content.replace(analysis.target, analysis.replacement);
    fs.writeFileSync(filePath, patched, 'utf8');

    const diff = fs.statSync(filePath).size - fs.statSync(filePath + '.bak').size;
    console.log(`  ✅ [${label}] Patched (+${diff} bytes)`);
    return true;
}

function revertFile(filePath, label) {
    const bak = filePath + '.bak';
    if (!fs.existsSync(bak)) {
        console.log(`  ⏭️  [${label}] No backup, skipping`);
        return;
    }
    fs.copyFileSync(bak, filePath);
    console.log(`  ✅ [${label}] Restored`);
}

function checkFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        console.log(`  ❌ [${label}] Not found`);
        return false;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const patched = content.includes('_aep=') && /_aep=\w+\(\(\)=>\{[^}]+EAGER/.test(content);
    const hasBak = fs.existsSync(filePath + '.bak');

    if (patched) {
        console.log(`  ✅ [${label}] PATCHED` + (hasBak ? ' (backup exists)' : ''));
    } else {
        const analysis = analyzeFile(content, label);
        if (analysis) {
            console.log(`  ⬜ [${label}] NOT PATCHED (patchable)`);
        } else {
            console.log(`  ⚠️  [${label}] NOT PATCHED (may be incompatible)`);
        }
    }
    return patched;
}

// ─── Version Info ───────────────────────────────────────────────────────────

function getVersion(basePath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'package.json'), 'utf8'));
        const product = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'product.json'), 'utf8'));
        return `${pkg.version} (IDE ${product.ideVersion})`;
    } catch { return 'unknown'; }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert' : args.includes('--check') ? 'check' : 'apply';

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Antigravity "Always Proceed" Auto-Run Fix      ║');
    console.log('╚══════════════════════════════════════════════════╝');

    const basePath = findAntigravityPath();
    if (!basePath) {
        console.log('\n❌ Antigravity not found! Install it or run from its directory.');
        process.exit(1);
    }

    console.log(`\n📍 ${basePath}`);
    console.log(`📦 Version: ${getVersion(basePath)}`);
    console.log('');

    const files = [
        { path: path.join(basePath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js'), label: 'workbench' },
        { path: path.join(basePath, 'resources', 'app', 'out', 'jetskiAgent', 'main.js'), label: 'jetskiAgent' },
    ];

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
