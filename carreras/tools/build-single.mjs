// Empaqueta el juego y Three.js en un único HTML autónomo (no necesita CDN).
// Uso (opcional):  npm i --no-save esbuild three@0.186.1  &&  node tools/build-single.mjs
// Resultado: dist/asfalto-gt.html
// Con --fragment <ruta> también escribe la versión sin <html>/<head>/<body>
// que usa la página publicada en claude.ai.
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, format: 'iife', minify: true, write: false,
  target: ['safari16'], legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = html.slice(html.indexOf('<!--APP-->') + '<!--APP-->'.length, html.indexOf('<!--/APP-->')).trim();
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];

const inner = `${fonts}\n<style>\n${css}</style>\n</head>\n<body>\n${app}\n<script>\n${js}</script>\n`;
const full = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0e1013">
<title>Asfalto GT</title>
${inner}</body>
</html>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/asfalto-gt.html'), full);
console.log('dist/asfalto-gt.html', (full.length / 1024).toFixed(0), 'KB');

const fi = process.argv.indexOf('--fragment');
if (fi > 0) {
  const fragment = `<title>Asfalto GT</title>\n${fonts}\n<style>\n${css}</style>\n${app}\n<script>\n${js}</script>\n`;
  fs.writeFileSync(process.argv[fi + 1], fragment);
  console.log(process.argv[fi + 1], (fragment.length / 1024).toFixed(0), 'KB');
}
