// Build único con esbuild: UI (navegador), servidor (Node) y proceso principal de Electron.
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');
fs.mkdirSync('dist/web', { recursive: true });
fs.copyFileSync('src/web/index.html', 'dist/web/index.html');
fs.copyFileSync('src/web/styles.css', 'dist/web/styles.css');
fs.copyFileSync('src/web/logo.png', 'dist/web/logo.png');
// Portadas por modelo incluidas en la app (WebP 768 × 768, fondo transparente).
fs.rmSync('dist/web/covers', { recursive: true, force: true });
if (fs.existsSync('src/web/covers')) fs.cpSync('src/web/covers', 'dist/web/covers', { recursive: true });

// Clave del repo de datos (secreto DATA_REPO_TOKEN en GitHub Actions) para que cada PC se conecte sola.
// Se ofusca para que no quede en texto plano; NO es cifrado real.
const rawToken = (process.env.DATA_REPO_TOKEN ?? '').trim();
const key = Buffer.from('celulares-al-costo');
const builtinToken = rawToken ? Buffer.from(Buffer.from(rawToken).map((x, i) => x ^ key[i % key.length])).toString('base64') : '';
if (rawToken) console.log('Clave del repo de datos incluida en el build.');

const common = { bundle: true, sourcemap: true, logLevel: 'info' };
const node = { ...common, loader: { '.txt': 'text' }, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'better-sqlite3', 'electron-updater'] };
const configs = [
  { ...common, entryPoints: ['src/web/main.tsx'], outfile: 'dist/web/app.js', platform: 'browser', format: 'esm',
    target: 'safari16', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, minify: !watch },
  { ...node, entryPoints: ['src/server/cli.ts'], outfile: 'dist/server.cjs' },
  { ...node, entryPoints: ['electron/main.ts'], outfile: 'dist/electron.cjs', sourcemap: false,
    define: { 'process.env.CEL_BUILTIN_REPO_TOKEN': JSON.stringify(builtinToken) } },
  { ...node, entryPoints: ['electron/preload.ts'], outfile: 'dist/preload.cjs' },
];

if (watch) for (const c of configs) await (await esbuild.context(c)).watch();
else await Promise.all(configs.map((c) => esbuild.build(c)));
