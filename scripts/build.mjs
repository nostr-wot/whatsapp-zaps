// Build the extension into dist/.
//
// Every entry is bundled into one self-contained IIFE. Content scripts —
// above all the MAIN-world one — cannot load chunks at runtime: a relative
// import() there resolves against web.whatsapp.com and its CSP refuses it.
// One file per entry also means nothing has to be web-accessible.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const outdir = 'dist';
const entries = {
  background: 'src/background.ts',
  main: 'src/content/main.ts',
  isolated: 'src/content/isolated.ts',
  options: 'src/options/options.ts',
};

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: entries,
  outdir,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  minify: process.argv.includes('--minify'),
  legalComments: 'none',
  logLevel: 'info',
});

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
writeFileSync(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
// The contacts page serves twice: as the options page, and as the toolbar
// popup (same page, compact layout, see `body.popup` in its stylesheet).
const optionsHtml = readFileSync('src/options/index.html', 'utf8')
  .replace('<script type="module" src="./options.ts"></script>', '<script src="options.js"></script>');
writeFileSync(`${outdir}/options.html`, optionsHtml);
writeFileSync(`${outdir}/popup.html`, optionsHtml.replace('<body>', '<body class="popup">'));
mkdirSync(`${outdir}/icons`, { recursive: true });
for (const file of readdirSync('icons')) if (file.endsWith('.png')) copyFileSync(`icons/${file}`, `${outdir}/icons/${file}`);
for (const notice of ['LICENSE', 'NOTICE']) copyFileSync(notice, `${outdir}/${notice}`);
