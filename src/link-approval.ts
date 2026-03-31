/**
 * Link Approval Fix — Automatically accepts all external link opening requests.
 *
 * Patches the validateLink method in the OpenerService to always return true.
 *
 * @module link-approval
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { getAppRoot } from './auto-run';

/** Marker comment to identify our patches */
const PATCH_MARKER = '/*BA:link-approval*/';

export async function patchFile(filePath: string): Promise<any> {
    try {
        let content = await fsp.readFile(filePath, 'utf8');

        if (content.includes(PATCH_MARKER)) {
            return { success: true, label: 'link-approval', status: 'already-patched' };
        }

        // Pattern: async validateLink(e,i){if(!cb(e,Oe.http)...
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

        return { success: true, label: 'link-approval', status: 'patched', bytesAdded: patch.length };
    } catch (err: any) {
        return { success: false, label: 'link-approval', status: 'error', error: err.message };
    }
}

export async function autoApply(): Promise<any[]> {
    const root = getAppRoot();
    if (!root) return [];

    const workbenchPath = path.join(root, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
    return [await patchFile(workbenchPath)];
}
