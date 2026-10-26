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
  theme: 'src/options/theme.ts',
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

// The extension pages' theme stylesheet, generated from src/ui/themes.ts so
// the page is drawn in the right colours before any script runs.
const themesModule = await build({ entryPoints: ['src/ui/themes.ts'], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
const { THEMES, themeCss, themeVars, topoCss } = await import(`data:text/javascript;base64,${Buffer.from(themesModule.outputFiles[0].text).toString('base64')}`);
const themeStyles = [
  themeCss(id => `[data-theme="${id}"]`),
  // Before theme.js has set data-theme (or without it): Nostr WoT Light or Dark.
  `:root:not([data-theme]) { ${themeVars(THEMES.light)} }`,
  `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${themeVars(THEMES.dark)} } }`,
].join('\n');

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
writeFileSync(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
// The contacts page serves twice: as the options page, and as the toolbar
// popup (same page, compact layout, see `body.popup` in its stylesheet).
const optionsHtml = readFileSync('src/options/index.html', 'utf8')
  .replace('<script src="./theme.ts"></script>', '<script src="theme.js"></script>')
  .replace('<script type="module" src="./options.ts"></script>', '<script src="options.js"></script>')
  .replace('/*@themes*/', () => themeStyles)
  .replace('/*@topo*/', () => topoCss('body', 'fixed'));
for (const marker of ['/*@themes*/', '/*@topo*/', './theme.ts', './options.ts']) {
  if (optionsHtml.includes(marker)) throw new Error(`options.html still contains ${marker}`);
}
writeFileSync(`${outdir}/options.html`, optionsHtml);
writeFileSync(`${outdir}/popup.html`, optionsHtml.replace('<body>', '<body class="popup">'));
mkdirSync(`${outdir}/icons`, { recursive: true });
for (const file of readdirSync('icons')) if (file.endsWith('.png')) copyFileSync(`icons/${file}`, `${outdir}/icons/${file}`);
for (const notice of ['LICENSE', 'NOTICE']) copyFileSync(notice, `${outdir}/${notice}`);
