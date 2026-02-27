#!/usr/bin/env node

/**
 * better-antigravity CLI
 * Usage:
 *   npx better-antigravity                  — list available fixes
 *   npx better-antigravity auto-run         — apply auto-run fix
 *   npx better-antigravity auto-run --check — check status
 *   npx better-antigravity auto-run --revert — revert fix
 */

const path = require('path');
const fs = require('fs');

const fixes = {
    'auto-run': {
        script: path.join(__dirname, 'fixes', 'auto-run-fix', 'patch.js'),
        description: '"Always Proceed" terminal policy doesn\'t auto-execute commands'
    }
};

const args = process.argv.slice(2);
const fixName = args[0];
const flags = args.slice(1);

// Header
console.log('');
console.log('  better-antigravity — community fixes for Antigravity IDE');
console.log('  https://github.com/Kanezal/better-antigravity');
console.log('');

if (!fixName || fixName === '--help' || fixName === '-h') {
    console.log('  Available fixes:');
    console.log('');
    for (const [name, fix] of Object.entries(fixes)) {
        console.log(`    ${name.padEnd(15)} ${fix.description}`);
    }
    console.log('');
    console.log('  Usage:');
    console.log('    npx better-antigravity <fix-name>           Apply fix');
    console.log('    npx better-antigravity <fix-name> --check   Check status');
    console.log('    npx better-antigravity <fix-name> --revert  Revert fix');
    console.log('');
    process.exit(0);
}

const fix = fixes[fixName];
if (!fix) {
    console.log(`  Unknown fix: "${fixName}"`);
    console.log(`  Available: ${Object.keys(fixes).join(', ')}`);
    process.exit(1);
}

if (!fs.existsSync(fix.script)) {
    console.log(`  Fix script not found: ${fix.script}`);
    process.exit(1);
}

// Forward to the fix script with flags
process.argv = [process.argv[0], fix.script, ...flags];
require(fix.script);
