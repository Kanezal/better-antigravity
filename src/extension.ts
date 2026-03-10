/**
 * Better Antigravity — Extension entry point.
 *
 * Thin orchestrator: wires up modules, no business logic here.
 *
 * @module extension
 */

import * as vscode from 'vscode';
import { AntigravitySDK } from 'antigravity-sdk';
import { autoApply } from './auto-run';
import { status, revertAutoRun } from './commands';
import { applyAutoScrollPatch, removeAutoScrollPatch } from './auto-scroll';

let sdk: AntigravitySDK | null = null;
let output: vscode.OutputChannel;

function log(msg: string): void {
    const ts = new Date().toISOString().substring(11, 19);
    output?.appendLine(`[${ts}] ${msg}`);
}

export async function activate(context: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel('Better Antigravity');
    context.subscriptions.push(output);
    log('Activating...');

    // ── Commands ──────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('better-antigravity.status', () => status(sdk, output)),
        vscode.commands.registerCommand('better-antigravity.revertAutoRun', revertAutoRun),
        vscode.commands.registerCommand('better-antigravity.removeAutoScrollPatch', removeAutoScrollPatch),
    );

    // ── Auto-Scroll Patch ──────────────────────────────────────────────
    applyAutoScrollPatch(context);

    // ── Auto-Run Fix (async, non-blocking, no prompt) ─────────────────
    autoApply().then(fixResults => {
        for (const r of fixResults) {
            log(`[auto-run] ${r.label}: ${r.status}${r.bytesAdded ? ` (+${r.bytesAdded}b)` : ''}${r.error ? ` -- ${r.error}` : ''}`);
        }
    });

    // ── SDK Init ─────────────────────────────────────────────────────
    try {
        sdk = new AntigravitySDK(context);
        await sdk.initialize();
        log(`SDK v${sdk.version} initialized`);

        // Title proxy for chat rename
        sdk.integration.enableTitleProxy();

        // Seamless install (handles first-time prompt + auto-reload on update)
        await sdk.integration.installSeamless(
            (cmd) => vscode.commands.executeCommand(cmd),
            (msg, ...items) => vscode.window.showInformationMessage(msg, ...items),
        );

        // Heartbeat (keeps renderer script alive)
        const hbTimer = setInterval(() => sdk?.integration.signalActive(), 30_000);
        context.subscriptions.push({ dispose: () => clearInterval(hbTimer) });

        // Auto-repair (re-patch after AG updates)
        sdk.integration.enableAutoRepair();

        log('Active');
    } catch (err: any) {
        log(`SDK init failed: ${err.message}`);
        log('Running in degraded mode (auto-run fix only)');
    }
}

export function deactivate() {
    sdk?.dispose();
    sdk = null;
}
