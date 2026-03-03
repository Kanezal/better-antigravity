/**
 * Better Antigravity — VS Code command handlers.
 *
 * Each exported function is a command handler registered in extension.ts.
 *
 * @module commands
 */

import * as vscode from 'vscode';
import { AntigravitySDK } from 'antigravity-sdk';
import { getWorkbenchDir, getTargetFiles, isPatched, revertAll, lastApplyResults } from './auto-run';

/**
 * Show extension status in the output channel.
 */
export async function status(sdk: AntigravitySDK | null, output: vscode.OutputChannel): Promise<void> {
    const lines = [
        '=== Better Antigravity ===',
        '',
        `SDK:     ${sdk?.isInitialized ? `v${sdk.version}` : 'not initialized'}`,
        `LS:      ${sdk?.ls?.isReady ? `port ${sdk.ls.port}` : 'not ready'}`,
        `UI:      ${sdk?.integration.isInstalled() ? 'installed' : 'not installed'}`,
        `Titles:  ${sdk?.integration.titles.count ?? 0} custom`,
    ];

    const dir = getWorkbenchDir();
    if (dir) {
        const files = getTargetFiles(dir);
        for (const f of files) {
            const patched = await isPatched(f.path);
            let statusStr = patched ? 'fixed' : 'not fixed';

            if (!patched && lastApplyResults) {
                const recent = lastApplyResults.find(r => r.label === f.label);
                if (recent && recent.status === 'pattern-not-found') {
                    statusStr = 'not fixed (A full IDE restart is required to apply patches)';
                }
            }

            lines.push(`AutoRun: ${f.label} = ${statusStr}`);
        }
    } else {
        lines.push('AutoRun: workbench directory not found');
    }

    output.appendLine(lines.join('\n'));
    output.show(true);
}

/**
 * Revert the auto-run fix and prompt for reload.
 */
export async function revertAutoRun(): Promise<void> {
    const dir = getWorkbenchDir();
    if (!dir) {
        vscode.window.showErrorMessage('Workbench directory not found.');
        return;
    }

    const results = revertAll();
    const reverted = results.filter(r => r.status === 'reverted').length;

    if (reverted > 0) {
        const action = await vscode.window.showInformationMessage(
            `Auto-run fix reverted (${reverted} file(s)). Reload to apply.`,
            'Reload Now',
        );
        if (action === 'Reload Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } else {
        vscode.window.showInformationMessage('No backups found. Nothing to revert.');
    }
}
