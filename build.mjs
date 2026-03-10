import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const config = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'es2020',
    sourcemap: true,
    minify: false,
};

// Ensure dist/ exists
if (!fs.existsSync('dist')) fs.mkdirSync('dist');

// Copy sql-wasm.wasm AND sql-wasm.js to dist/ (required by antigravity-sdk's StateBridge)
const sqlFiles = ['sql-wasm.wasm', 'sql-wasm.js'];
for (const sqlFile of sqlFiles) {
    const searchPaths = [
        path.join('node_modules', 'sql.js', 'dist', sqlFile),
        path.join('..', 'antigravity-sdk', 'node_modules', 'sql.js', 'dist', sqlFile),
    ];

    let copied = false;
    for (const src of searchPaths) {
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join('dist', sqlFile));
            console.log(`Copied ${sqlFile} from ${src}`);
            copied = true;
            break;
        }
    }
    if (!copied) {
        console.error(`ERROR: ${sqlFile} not found. Run "npm install" first.`);
        process.exit(1);
    }
}

if (isWatch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log('Watching...');
} else {
    await esbuild.build(config);
    console.log('Build complete');
}
