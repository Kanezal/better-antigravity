/**
 * Auto-Run Fix — Patches the "Always Proceed" terminal policy to actually auto-execute.
 *
 * Uses structural regex matching to find the onChange handler in minified code
 * and injects a missing useEffect that auto-confirms commands when policy is EAGER.
 *
 * Works across AG versions because it matches code STRUCTURE, not variable NAMES.
 *
 * ## File targets (AG v1.107+)
 *
 *   out/vs/workbench/workbench.desktop.main.js  — main IDE window (Lau component)
 *   out/jetskiAgent/main.js                     — chat panel (LSi component)
 *
 * ## AG version history
 *
 *   < v1.107  jetskiAgent bundle was at: out/vs/code/electron-browser/workbench/jetskiAgent.js
 *   ≥ v1.107  jetskiAgent bundle moved to: out/jetskiAgent/main.js
 *             (old path is now a tiny bootstrap that imports the new location)
 *
 * ## Regex change (v1.107)
 *
 *   OLD: `(arg)=>{setFn(arg),arg===ENUM.EAGER&&confirm(!0)}`
 *        — parens around single arg, direct function call
 *   NEW: `arg=>{ref?.setTerminalAutoExecutionPolicy?.(arg),arg===ENUM.EAGER&&confirm(!0)}`
 *        — no parens (minifier drops them), optional chaining method call
 *
 * @module auto-run
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

/** Marker comment to identify our patches */
const PATCH_MARKER = '/*BA:autorun*/';

// ─── Version Gating ─────────────────────────────────────────────────────────

/**
 * Supported AG app version range (from resources/app/package.json).
 * Patch is tested on these versions; outside this range it may brick the IDE.
 */
const SUPPORTED_MIN: [number, number, number] = [1, 107, 0];
const SUPPORTED_MAX: [number, number, number] = [1, 199, 0];

function parseVersion(str: string | undefined | null): [number, number, number] | null {
    const parts = (str || '').split('.').map(Number);
    return parts.length === 3 && parts.every(n => Number.isFinite(n))
        ? parts as [number, number, number]
        : null;
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

export interface VersionCheck {
    ok: boolean;
    version: string;
    ideVersion?: string;
    reason?: string;
}

/**
 * Read AG version from the app root and check if it's within the supported range.
 */
export function checkAgVersion(appRoot: string): VersionCheck {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
        const product = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
        const appVersion: string = pkg.version;
        const ideVersion: string = product.ideVersion;
        const parsed = parseVersion(appVersion);

        if (!parsed) {
            return { ok: false, version: appVersion || 'unknown', ideVersion,
                reason: 'Could not parse Antigravity version.' };
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
    } catch {
        return { ok: false, version: 'unknown', reason: 'Could not read Antigravity version files.' };
    }
}

/**
 * Resolve the Antigravity app root (resources/app directory).
 */
export function getAppRoot(): string | null {
    const appData = process.env.LOCALAPPDATA || '';
    const dir = path.join(appData, 'Programs', 'Antigravity', 'resources', 'app');
    return fs.existsSync(dir) ? dir : null;
}

/**
 * Resolve the Antigravity workbench HTML directory.
 * Used by integration module for workbench.html patching.
 */
export function getWorkbenchDir(): string | null {
    const appData = process.env.LOCALAPPDATA || '';
    const dir = path.join(
        appData,
        'Programs', 'Antigravity', 'resources', 'app', 'out',
        'vs', 'code', 'electron-browser', 'workbench',
    );
    return fs.existsSync(dir) ? dir : null;
}

/**
 * Target files that need the auto-run patch.
 *
 * Supports both old (< v1.107) and new (≥ v1.107) AG layouts.
 * Files are filtered to only existing paths; analyzeFile() will return
 * null for bootstrap stubs (old jetskiAgent.js) with no EAGER content.
 */
export function getTargetFiles(appRoot: string): Array<{ path: string; label: string }> {
    return [
        // Main workbench JS (correct path — was never in workbenchDir!)
        { path: path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'), label: 'workbench' },
        // Chat panel — new location (AG ≥ v1.107)
        { path: path.join(appRoot, 'out', 'jetskiAgent', 'main.js'), label: 'jetskiAgent' },
        // Chat panel — old location (AG < v1.107, kept for backward compat)
        { path: path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'jetskiAgent.js'), label: 'jetskiAgent-legacy' },
    ].filter(f => fs.existsSync(f.path));
}

/**
 * Check if a file already has the auto-run patch applied.
 */
export async function isPatched(filePath: string): Promise<boolean> {
    try {
        const content = await fsp.readFile(filePath, 'utf8');
        return content.includes(PATCH_MARKER);
    } catch {
        return false;
    }
}

/**
 * Analyze a file to find the onChange handler and extract variable names.
 *
 * Returns null if pattern not found (bootstrap stub, file fixed by AG, etc.).
 *
 * Anchor strategy: search for the literal string "setTerminalAutoExecutionPolicy"
 * first, then match the useCallback structure within a 500-char window.
 * String literals survive minification better than variable names.
 */
function analyzeFile(content: string): AnalysisResult | null {
    // Find the onChange handler for terminalAutoExecutionPolicy.
    //
    // AG v1.107+ pattern (optional chaining, no parens on single arg):
    //   onChange = useCallback(arg => {
    //     ref?.setTerminalAutoExecutionPolicy?.(arg),
    //     arg === ENUM.EAGER && confirmFn(!0)
    //   }, [ref, confirmFn])
    //
    // Captures: (onChange)(useCallback)(arg)(ref)(ENUM)(confirmFn)
    const onChangeRegex = /(\w+)=(\w+)\((\w+)=>\{(\w+)\?\.setTerminalAutoExecutionPolicy\?\.\(\3\),\3===(\w+)\.EAGER&&(\w+)\(!0\)\},\[/g;
    const match = onChangeRegex.exec(content);

    if (!match) return null;

    const [fullMatch, , , , , enumName, confirmFn] = match;
    const insertPos = match.index + fullMatch.length;

    // Extract context variables from surrounding code
    const contextStart = Math.max(0, match.index - 3000);
    const contextEnd = Math.min(content.length, match.index + 3000);
    const context = content.substring(contextStart, contextEnd);

    // policyVar: var = ref?.terminalAutoExecutionPolicy ?? ENUM.OFF
    const policyMatch = /(\w+)=\w+\?\.terminalAutoExecutionPolicy\?\?(\w+)\.OFF/.exec(context);
    // secureVar: var = ref?.secureModeEnabled ?? !1
    const secureMatch = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/.exec(context);

    if (!policyMatch || !secureMatch) return null;

    const policyVar = policyMatch[1];
    const secureVar = secureMatch[1];

    // Find useEffect alias in this file
    const useEffectFn = findUseEffect(content, context, [confirmFn]);
    if (!useEffectFn) return null;

    // Find insertion point: after the useCallback closing `])`, then after the `;`
    // that ends the entire let declaration (the comma-separated declarators
    // between onChange and return don't contain `;`).
    const afterOnChange = content.indexOf('])', insertPos);
    if (afterOnChange === -1) return null;

    const insertAt = content.indexOf(';', afterOnChange);
    if (insertAt === -1) return null;

    return {
        enumName,
        confirmFn,
        policyVar,
        secureVar,
        useEffectFn,
        insertAt: insertAt + 1,
    };
}

/**
 * Find the useEffect function alias using a three-phase strategy.
 *
 * Phase 1 (declaration): `useEffect:()=>fn` in export tables — most reliable.
 * Phase 2 (cleanup-return): only useEffect returns a cleanup function `()=>`.
 * Phase 3 (frequency): most-called `fn(()=>{` in context — last resort.
 */
function findUseEffect(fullContent: string, context: string, exclude: string[]): string | null {
    // Phase 1: declaration in export/re-export table
    // Pattern: useEffect:()=>fn  (Preact/React runtime exports)
    const declMatch = fullContent.match(/useEffect:\(\)=>(\w+)/);
    if (declMatch) return declMatch[1];

    // Phase 2: cleanup-return pattern — only useEffect returns `() =>`
    const cleanupRegex = /\b(\w{1,4})\(\(\)=>\{[\s\S]{1,500}?return\s*\(\)=>/g;
    const cleanupCandidates: Record<string, number> = {};
    let m: RegExpExecArray | null;
    while ((m = cleanupRegex.exec(context)) !== null) {
        const fn = m[1];
        if (!exclude.includes(fn) && !/^(var|let|for|new|if)$/.test(fn)) {
            cleanupCandidates[fn] = (cleanupCandidates[fn] || 0) + 1;
        }
    }
    const cleanupBest = Object.entries(cleanupCandidates).sort((a, b) => b[1] - a[1])[0];
    if (cleanupBest) return cleanupBest[0];

    // Phase 3: frequency analysis — most common fn(()=>{ in scope
    const candidates: Record<string, number> = {};
    const freqRegex = /\b(\w{1,4})\(\(\)=>\{/g;
    while ((m = freqRegex.exec(context)) !== null) {
        const fn = m[1];
        if (!exclude.includes(fn) && !/^(var|let|for|new|if)$/.test(fn)) {
            candidates[fn] = (candidates[fn] || 0) + 1;
        }
    }
    const freqBest = Object.entries(candidates).sort((a, b) => b[1] - a[1])[0];
    return freqBest?.[0] ?? null;
}

interface AnalysisResult {
    enumName: string;
    confirmFn: string;
    policyVar: string;
    secureVar: string;
    useEffectFn: string;
    insertAt: number;
}

/**
 * Apply the auto-run patch to a single file.
 *
 * @returns Patch status message
 */
export async function patchFile(filePath: string, label: string): Promise<PatchResult> {
    try {
        let content = await fsp.readFile(filePath, 'utf8');

        if (content.includes(PATCH_MARKER)) {
            return { success: true, label, status: 'already-patched' };
        }

        const analysis = analyzeFile(content);
        if (!analysis) {
            if (label === 'jetskiAgent-legacy') {
                return { success: true, label, status: 'skipped' };
            }
            return { success: false, label, status: 'pattern-not-found' };
        }

        const { enumName, confirmFn, policyVar, secureVar, useEffectFn, insertAt } = analysis;

        // Build the patch: useEffect that auto-confirms on mount when policy is EAGER.
        // Trailing `;` is required — insertion point is right before `return`, and in
        // minified one-liner code `fn(...)return` is a SyntaxError without it.
        const patch = `${PATCH_MARKER}${useEffectFn}(()=>{${policyVar}===${enumName}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[]);`;

        // Create backup (only if one doesn't exist)
        const backup = filePath + '.ba-backup';
        try { await fsp.access(backup); } catch {
            await fsp.copyFile(filePath, backup);
        }

        // Insert patch after the let declaration semicolon
        content = content.substring(0, insertAt) + patch + content.substring(insertAt);
        await fsp.writeFile(filePath, content, 'utf8');

        return { success: true, label, status: 'patched', bytesAdded: patch.length };
    } catch (err: any) {
        return { success: false, label, status: 'error', error: err.message };
    }
}

/**
 * Revert the auto-run patch on a single file.
 */
export function revertFile(filePath: string, label: string): PatchResult {
    const backup = filePath + '.ba-backup';
    if (!fs.existsSync(backup)) {
        return { success: false, label, status: 'no-backup' };
    }

    try {
        fs.copyFileSync(backup, filePath);
        fs.unlinkSync(backup);
        return { success: true, label, status: 'reverted' };
    } catch (err: any) {
        return { success: false, label, status: 'error', error: err.message };
    }
}

export interface PatchResult {
    success: boolean;
    label: string;
    status: 'patched' | 'already-patched' | 'pattern-not-found' | 'skipped' | 'reverted' | 'no-backup' | 'version-blocked' | 'error';
    bytesAdded?: number;
    error?: string;
}

/**
 * Auto-apply the fix to all target files.
 * Blocks patching if the AG version is outside the supported range
 * unless `force` is true.
 *
 * @returns Array of results for each file
 */
export async function autoApply(force = false): Promise<PatchResult[]> {
    const root = getAppRoot();
    if (!root) return [];

    // Version gate
    const vc = checkAgVersion(root);
    if (!vc.ok && !force) {
        return [{
            success: false,
            label: 'version-check',
            status: 'version-blocked',
            error: `${vc.reason} Supported: ${SUPPORTED_MIN.join('.')}–${SUPPORTED_MAX.join('.')}. AG: ${vc.version}`,
        }];
    }

    const files = getTargetFiles(root);
    return Promise.all(files.map(f => patchFile(f.path, f.label)));
}

/**
 * Revert all target files from backups.
 */
export function revertAll(): PatchResult[] {
    const root = getAppRoot();
    if (!root) return [];

    const files = getTargetFiles(root);
    return files.map(f => revertFile(f.path, f.label));
}
