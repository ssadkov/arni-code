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
    // The client secret is not committed: GitHub secret scanning flags it in a
    // public repo. CI passes it from a repository secret at build time.
    define: {
      'process.env.GOOGLE_DESKTOP_CLIENT_SECRET': JSON.stringify(process.env.GOOGLE_DESKTOP_CLIENT_SECRET || ''),
    },
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
