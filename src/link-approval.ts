/**
 * Link Approval Fix — Automatically accepts all external link opening requests.
 *
 * Patches the validateLink method in the OpenerService to always return true,
 * skipping the confirmation dialog for external links.
 *
 * Only targets workbench.desktop.main.js (validateLink is not in jetskiAgent).
 * Verified on AG v1.107.0: exactly 1 match of `async validateLink(e,i){`.
 *
 * Based on work by @jyongchul (PR #23).
 *
 * @module link-approval
 */

import * as path from 'path';
import * as fsp from 'fs/promises';
import { getAppRoot, checkAgVersion, type PatchResult, type VersionCheck } from './auto-run';

/** Marker comment to identify our patches */
const PATCH_MARKER = '/*BA:link-approval*/';

/**
 * Apply the link-approval patch to a single file.
 */
async function patchFile(filePath: string): Promise<PatchResult> {
    try {
        let content = await fsp.readFile(filePath, 'utf8');

        if (content.includes(PATCH_MARKER)) {
            return { success: true, label: 'link-approval', status: 'already-patched' };
        }

        // Pattern: async validateLink(e,i){if(!cb(e,Oe.http)...
        // Verified on AG v1.107.0: exactly 1 match in workbench.desktop.main.js
        const validateLinkRe = /async validateLink\((\w+),(\w+)\)\{/;
        const match = content.match(validateLinkRe);

        if (!match) {
            return { success: false, label: 'link-approval', status: 'pattern-not-found' };
        }

        const [fullMatch] = match;
        const patch = `${fullMatch}${PATCH_MARKER}return !0;`;

        // Create backup (only if one doesn't exist)
        const backup = filePath + '.ba-backup';
        try { await fsp.access(backup); } catch {
            await fsp.copyFile(filePath, backup);
        }

        content = content.replace(fullMatch, patch);
        await fsp.writeFile(filePath, content, 'utf8');

        return { success: true, label: 'link-approval', status: 'patched', bytesAdded: PATCH_MARKER.length + 'return !0;'.length };
    } catch (err: any) {
        return { success: false, label: 'link-approval', status: 'error', error: err.message };
    }
}

/**
 * Auto-apply the link-approval fix.
 * Blocks patching if the AG version is outside the supported range
 * unless `force` is true.
 */
export async function autoApply(force = false): Promise<PatchResult[]> {
    const root = getAppRoot();
    if (!root) return [];

    const vc = checkAgVersion(root);
    if (!vc.ok && !force) {
        return [{
            success: false,
            label: 'link-approval',
            status: 'version-blocked',
            error: vc.reason,
        }];
    }

    const workbenchPath = path.join(root, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
    return [await patchFile(workbenchPath)];
}
