/**
 * Auto-Scroller Fix
 * 
 * Patches the `workbench.html` file to inject a custom payload that 
 * auto-scrolls the Antigravity chat window and modifies the product.json checksum.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';

/**
 * Gets the base paths for Antigravity installations using process.env
 */
function getAntigravityPaths() {
    const appData = process.env.LOCALAPPDATA || '';
    const baseDir = path.join(appData, 'Programs', 'Antigravity', 'resources', 'app');
    
    return {
        baseDir,
        productJsonPath: path.join(baseDir, 'product.json'),
        workbenchHtmlPath: path.join(baseDir, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        // Relative path identifier for checksums Dictionary
        workbenchHtmlChecksumKey: 'vs/code/electron-sandbox/workbench/workbench.html'
    };
}

/**
 * Computes SHA256 base64 hash matching VS Code's internal checksum format.
 */
function computeChecksum(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
}

/**
 * Safely writes a file, ensuring permissions are handled.
 */
async function writeFileSafely(filePath: string, content: string | Buffer): Promise<void> {
    try {
        await fsp.writeFile(filePath, content);
    } catch (err: any) {
        if (err.code === 'EPERM' || err.code === 'EACCES') {
            throw new Error(`Permission denied writing to ${filePath}. Please run Antigravity as Administrator.`);
        }
        throw err;
    }
}

/**
 * Injects the auto-scroll payload script into workbench.html and updates product.json.
 */
export async function applyAutoScrollPatch(context: vscode.ExtensionContext): Promise<void> {
    const paths = getAntigravityPaths();

    if (!fs.existsSync(paths.workbenchHtmlPath)) {
        vscode.window.showWarningMessage('Better Antigravity: Could not find workbench.html to patch.');
        return;
    }

    try {
        let workbenchHtml = await fsp.readFile(paths.workbenchHtmlPath, 'utf8');

        // Check if already patched
        if (workbenchHtml.includes('<!-- BA: Auto-Scroller Payload -->')) {
            return; // Already patched
        }

        const payloadPath = vscode.Uri.file(path.join(context.extensionPath, 'static', 'payload.js')).with({ scheme: 'vscode-file' });
        const scriptTag = `\n\t<!-- BA: Auto-Scroller Payload -->\n\t<script src="${payloadPath.toString()}"></script>\n`;

        // Create Backup
        const backupPath = paths.workbenchHtmlPath + '.bak';
        try { await fsp.access(backupPath); } catch {
            await fsp.copyFile(paths.workbenchHtmlPath, backupPath);
        }

        // Insert before </html>
        workbenchHtml = workbenchHtml.replace('</html>', `${scriptTag}</html>`);
        
        // Write patched HTML
        const newHtmlBuffer = Buffer.from(workbenchHtml, 'utf8');
        await writeFileSafely(paths.workbenchHtmlPath, newHtmlBuffer);

        // Update product.json checksum so UI doesn't complain about corruption
        if (fs.existsSync(paths.productJsonPath)) {
            const productJsonString = await fsp.readFile(paths.productJsonPath, 'utf8');
            const productJson = JSON.parse(productJsonString);
            
            // Backup product.json
            const productBackupPath = paths.productJsonPath + '.bak';
            try { await fsp.access(productBackupPath); } catch {
                await fsp.writeFile(productBackupPath, productJsonString, 'utf8');
            }

            if (!productJson.checksums) {
                productJson.checksums = {};
            }

            productJson.checksums[paths.workbenchHtmlChecksumKey] = computeChecksum(newHtmlBuffer);
            await writeFileSafely(paths.productJsonPath, JSON.stringify(productJson, null, '\t'));
        }

        // Prompt user to reload
        const reloadAction = 'Reload Window';
        const result = await vscode.window.showInformationMessage(
            'Better Antigravity: Auto-Scroller extension installed successfully.',
            reloadAction
        );

        if (result === reloadAction) {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }

    } catch (err: any) {
        vscode.window.showErrorMessage(`Better Antigravity Error: ${err.message}`);
    }
}

/**
 * Removes the patch, restores backups, and resets the product checksum.
 */
export async function removeAutoScrollPatch(): Promise<void> {
    const paths = getAntigravityPaths();
    
    const workbenchBackupPath = paths.workbenchHtmlPath + '.bak';
    const productBackupPath = paths.productJsonPath + '.bak';
    
    let restored = false;

    try {
        // Restore workbench.html
        if (fs.existsSync(workbenchBackupPath)) {
            await fsp.copyFile(workbenchBackupPath, paths.workbenchHtmlPath);
            await fsp.unlink(workbenchBackupPath);
            restored = true;
        }

        // Restore product.json
        if (fs.existsSync(productBackupPath)) {
            await fsp.copyFile(productBackupPath, paths.productJsonPath);
            await fsp.unlink(productBackupPath);
            restored = true;
        }

        if (restored) {
            const reloadAction = 'Reload Window';
            const result = await vscode.window.showInformationMessage(
                'Better Antigravity: Auto-Scroller patch removed successfully. Clean state restored.',
                reloadAction
            );

            if (result === reloadAction) {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } else {
            vscode.window.showInformationMessage('Better Antigravity: No backups found to restore.');
        }

    } catch (err: any) {
        vscode.window.showErrorMessage(`Better Antigravity Error resolving removal: ${err.message}`);
    }
}
