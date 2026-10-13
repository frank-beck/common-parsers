// Baut jeden Parser und die Runtime zu je einem eigenständigen ES-Modul und
// schreibt dist/manifest.json mit SHA-256 je Datei.
//
// Die Module sind nicht minifiziert: Das Repository ist öffentlich, und wer
// einen Parser in seine App lädt, soll lesen können, was er ausführt.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const ID = /^[a-z0-9][a-z0-9-]{1,48}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

async function bundle(contents, outfile) {
  await build({
    stdin: { contents, resolveDir: root, sourcefile: 'entry.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    legalComments: 'none',
    outfile,
    logLevel: 'warning'
  });
  const bytes = await readFile(outfile);
  return createHash('sha256').update(bytes).digest('hex');
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const { parserEntries } = await import(pathToFileURL(join(root, 'scripts/entries.mjs')).href);

const runtimeFile = `runtime-${pkg.version}.mjs`;
const runtime = {
  version: pkg.version,
  file: runtimeFile,
  sha256: await bundle(`export * from './src/runtime.ts';`, join(dist, runtimeFile))
};

const parsers = [];
const seen = new Set();
for (const [key, entry] of Object.entries(parserEntries)) {
  const [source, exportName] = entry.split('#');
  const tmp = join(dist, `.tmp-${key}.mjs`);
  await bundle(`export { ${exportName} as default } from './${source}';`, tmp);
  const parser = (await import(`${pathToFileURL(tmp).href}?v=${Date.now()}`)).default;
  await rm(tmp);

  if (!ID.test(parser.id)) throw new Error(`${key}: ungültige id "${parser.id}"`);
  if (!SEMVER.test(parser.version)) throw new Error(`${key}: version "${parser.version}" ist kein x.y.z`);
  if (parser.id !== key) throw new Error(`${key}: Eintrag und id "${parser.id}" passen nicht`);
  if (seen.has(parser.id)) throw new Error(`${parser.id}: doppelt`);
  seen.add(parser.id);

  const file = `${parser.id}-${parser.version}.mjs`;
  const sha256 = await bundle(`export { ${exportName} as default } from './${source}';`, join(dist, file));
  parsers.push({
    id: parser.id,
    version: parser.version,
    family: parser.family,
    label: parser.label,
    fallback: parser.fallback === true,
    file,
    sha256
  });
}

const fallbacks = parsers.filter((parser) => parser.fallback);
if (fallbacks.length !== 1) throw new Error(`Genau ein Parser braucht fallback: true, gefunden: ${fallbacks.length}`);

// Kein Zeitstempel: derselbe Stand ergibt dasselbe Manifest und dieselbe Signatur.
const manifest = { schema: 1, name: pkg.name, version: pkg.version, runtime, parsers };
await writeFile(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`dist/manifest.json: Runtime ${runtime.version}, ${parsers.length} Parser`);
for (const parser of parsers) console.log(`  ${parser.id}@${parser.version} ${parser.sha256.slice(0, 12)}`);
