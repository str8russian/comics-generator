import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {readFile} from 'node:fs/promises';

const specPath = process.argv[2];
const outputPath = process.argv[3];
if (!specPath || !outputPath) {
  console.error('usage: render-spec.mjs <spec.json> <output.mp4>');
  process.exit(1);
}

const spec = JSON.parse(await readFile(specPath, 'utf8'));
const serveUrl = await bundle({
  entryPoint: path.resolve('src/index.jsx'),
  webpackOverride: (config) => config,
});
const inputProps = {spec};
const composition = await selectComposition({
  serveUrl,
  id: 'CurrentStoryboard',
  inputProps,
});
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: outputPath,
  inputProps,
});
