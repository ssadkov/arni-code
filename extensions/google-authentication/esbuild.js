let esbuild;
try {
  esbuild = require("esbuild");
} catch (e) {
  try {
    esbuild = require("../arni-agent/node_modules/esbuild");
  } catch (e2) {
    throw new Error("esbuild not found. Run 'npm install' first.");
  }
}

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info'
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
