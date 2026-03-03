/**
 * Auto-Run Fix — Patches the "Always Proceed" terminal policy to actually auto-execute.
 *
 * Uses structural regex matching to find the onChange handler in minified code
 * and injects a missing useEffect that auto-confirms commands when policy is EAGER.
 *
 * Works across AG versions because it matches code STRUCTURE, not variable NAMES.
 *
 * @module auto-run
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

/** Marker comment to identify our patches */
const PATCH_MARKER = '/*BA:autorun*/';

/**
 * Resolve the Antigravity workbench directory.
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
 */
export function getTargetFiles(workbenchDir: string): Array<{ path: string; label: string }> {
    return [
        { path: path.join(workbenchDir, 'workbench.desktop.main.js'), label: 'workbench' },
        { path: path.join(workbenchDir, 'jetskiAgent.js'), label: 'jetskiAgent' },
    ].filter(f => fs.existsSync(f.path));
}

/**
 * Check if a file already has the auto-run patch applied.
 */
export async function isPatched(filePath: string): Promise<boolean> {
    try {
        // Read only first 50 bytes of the marker area via a small buffer scan
        // The marker is injected mid-file, so we must read the full file.
        // Use async to avoid blocking extension host.
        const content = await fsp.readFile(filePath, 'utf8');
        return content.includes(PATCH_MARKER);
    } catch {
        return false;
    }
}

/**
 * Analyze a file to find the onChange handler and extract variable names.
 *
 * Returns null if pattern not found (file may already be fixed by AG update).
 */
function analyzeFile(content: string): AnalysisResult | null {
    // Find onChange handler for terminalAutoExecutionPolicy
    // Pattern: <callback>=<useCallback>((<arg>)=>{<setFn>(<arg>),<arg>===<ENUM>.EAGER&&<confirm>(true)},[...])
    const onChangeRegex = /(\w+)=(\w+)\((\(\w+\))=>\{(\w+)\(\w+\),\w+===(\w+)\.EAGER&&(\w+)\(!0\)\},\[/g;
    const match = onChangeRegex.exec(content);

    if (!match) return null;

    const [fullMatch, , , , , enumName, confirmFn] = match;
    const insertPos = match.index + fullMatch.length;

    // Extract context variables from surrounding code
    const contextStart = Math.max(0, match.index - 3000);
    const contextEnd = Math.min(content.length, match.index + 3000);
    const context = content.substring(contextStart, contextEnd);

    // policyVar: <var>=<something>?.terminalAutoExecutionPolicy??<ENUM>.OFF
    const policyMatch = /(\w+)=\w+\?\.terminalAutoExecutionPolicy\?\?(\w+)\.OFF/.exec(context);
    // secureVar: <var>=<something>?.secureModeEnabled??!1
    const secureMatch = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/.exec(context);

    if (!policyMatch || !secureMatch) return null;

    const policyVar = policyMatch[1];
    const secureVar = secureMatch[1];

    // Find useEffect — most frequently used short-named function in the scope
    const useEffectFn = findUseEffect(context, [confirmFn]);

    if (!useEffectFn) return null;

    // Find insertion point: after the useCallback closing
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
 * Find the useEffect function name by frequency analysis.
 */
function findUseEffect(context: string, exclude: string[]): string | null {
    const candidates: Record<string, number> = {};
    const regex = /(\w{1,3})\(\(\)=>\{/g;
    let m;

    while ((m = regex.exec(context)) !== null) {
        const fn = m[1];
        if (fn.length <= 3 && !exclude.includes(fn)) {
            candidates[fn] = (candidates[fn] || 0) + 1;
        }
    }

    let best = '';
    let maxCount = 0;
    for (const [fn, count] of Object.entries(candidates)) {
        if (count > maxCount) {
            best = fn;
            maxCount = count;
        }
    }

    return best || null;
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
            return { success: false, label, status: 'pattern-not-found' };
        }

        const { enumName, confirmFn, policyVar, secureVar, useEffectFn, insertAt } = analysis;

        // Build the patch
        const patch = `${PATCH_MARKER}${useEffectFn}(()=>{${policyVar}===${enumName}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[])`;

        // Create backup (only if one doesn't exist)
        const backup = filePath + '.ba-backup';
        try { await fsp.access(backup); } catch {
            await fsp.copyFile(filePath, backup);
        }

        // Insert
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
    status: 'patched' | 'already-patched' | 'pattern-not-found' | 'reverted' | 'no-backup' | 'error';
    bytesAdded?: number;
    error?: string;
}

export let lastApplyResults: PatchResult[] | null = null;

/**
 * Auto-apply the fix to all target files.
 *
 * @returns Array of results for each file
 */
export async function autoApply(): Promise<PatchResult[]> {
    const dir = getWorkbenchDir();
    if (!dir) return [];

    const files = getTargetFiles(dir);
    lastApplyResults = await Promise.all(files.map(f => patchFile(f.path, f.label)));
    return lastApplyResults;
}

/**
 * Revert all target files from backups.
 *
 * @returns Number of files reverted
 */
export function revertAll(): PatchResult[] {
    const dir = getWorkbenchDir();
    if (!dir) return [];

    const files = getTargetFiles(dir);
    return files.map(f => revertFile(f.path, f.label));
}
