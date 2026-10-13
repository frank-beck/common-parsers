// Liest einen echten Beleg auf diesem Rechner — so, wie die App es im Browser tut —
// und zeigt, welcher Parser greift und was er findet.
//
//   npm run lesen -- privat/beleg.pdf      PDF mit Textschicht
//   npm run lesen -- privat/beleg.txt      Text, z. B. aus der Texterkennung der App
//   … --json                               zusätzlich den ganzen Entwurf
//
// Schreibt privat/<name>.txt (echter Text) und, wenn privat/ersetzen.txt da ist,
// privat/<name>.muster.txt mit erfundenen Angaben. Nichts verlässt den Rechner.
// Nicht von einer KI ausführen lassen: die Ausgabe enthält den echten Beleg.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { alsWort, pruefe } from './datenschutz.mjs';
import { seitenAlsText, seitenAusText } from './seiten.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privat = join(root, 'privat');
const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--'));
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!input) fail('Aufruf: npm run lesen -- privat/<beleg>.pdf');
const path = resolve(input);
if (!existsSync(path)) fail(`${input} gibt es nicht`);
if (relative(privat, path).startsWith('..')) {
  fail(`Echte Belege nur unter privat/ — der Ordner ist von git ausgeschlossen.\n  mkdir -p privat && mv "${input}" privat/`);
}

// Parser aus den TypeScript-Quellen, ohne vorher `npm run build`.
const bundled = await build({
  stdin: {
    contents: `export * from './src/runtime.ts'; export { parsers } from './src/parsers/index.ts';`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'error'
});
const { MIN_TEXT_CHARS, MAX_PAGES, normalizeItems, parsers, selectParser, textCharacters } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`
);

async function pdfSeiten(file) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PAGES); pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push({ pageNumber, text: normalizeItems(content.items) });
    }
    if (pdf.numPages > MAX_PAGES) console.log(`⚠ ${pdf.numPages} Seiten, die App liest nur ${MAX_PAGES}`);
    return pages;
  } finally {
    await pdf.destroy();
  }
}

const pdf = extname(path).toLowerCase() === '.pdf';
const pages = pdf ? await pdfSeiten(path) : seitenAusText(readFileSync(path, 'utf8'));
const name = basename(path, extname(path)).replace(/\.muster$/, '');

if (textCharacters(pages) < MIN_TEXT_CHARS) {
  console.log(`\nScan: ${textCharacters(pages)} Zeichen Text, unter ${MIN_TEXT_CHARS}. Die App nimmt hier die Texterkennung.`);
  console.log('Text holen: lokal in NADIA Neue Reise → PDF → „Erkannter Text“ aufklappen,');
  console.log(`Seiten nach privat/${name}.txt kopieren (Format: Zeile „=== Seite 1 ===“ vor jeder Seite),`);
  console.log(`dann: npm run lesen -- privat/${name}.txt\n`);
  process.exit(0);
}

if (pdf) {
  writeFileSync(join(privat, `${name}.txt`), seitenAlsText(pages));
  console.log(`\nText:   privat/${name}.txt  (echt, bleibt hier)`);
}

// Erfundene Fassung: jede linke Seite aus privat/ersetzen.txt durch die rechte.
const ersetzen = join(privat, 'ersetzen.txt');
if (existsSync(ersetzen)) {
  const paare = readFileSync(ersetzen, 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => line.split('=').map((part) => part.trim()))
    .filter(([echt]) => echt.length >= 3)
    .sort((a, b) => b[0].length - a[0].length);
  let muster = seitenAlsText(pages);
  for (const [echt, erfunden = 'MUSTER'] of paare) {
    muster = muster.replace(new RegExp(alsWort(echt).source, 'giu'), (treffer) =>
      treffer === treffer.toUpperCase() ? erfunden.toUpperCase() : erfunden
    );
  }
  const datei = `privat/${name}.muster.txt`;
  writeFileSync(join(root, datei), muster);
  console.log(`Muster: ${datei}  (${paare.length} Ersetzungen — jetzt lesen, Rest von Hand ersetzen)`);
  const reste = pruefe([{ path: 'muster.txt', content: Buffer.from(muster) }], paare.map(([echt]) => echt));
  for (const { line, problem } of reste) console.log(`  ⚠ Zeile ${line}: ${problem}`);
} else {
  console.log('Muster: keins — privat/ersetzen.txt fehlt (docs/neuer-parser.md, Schritt 3)');
}

console.log('\nErkennung (ab 0,80 sicher):');
for (const parser of parsers.filter((p) => !p.fallback)) {
  let score = 0;
  try {
    score = parser.detect(pages);
  } catch (error) {
    console.log(`  ${parser.id}: wirft ${error.message}`);
    continue;
  }
  console.log(`  ${score.toFixed(2)}  ${parser.id}`);
}
const match = selectParser(parsers, pages);
const parser = match?.parser ?? parsers.find((p) => p.fallback);
console.log(`→ ${parser.id}@${parser.version}${match ? '' : ' (Auffang: kein Parser erkannt)'}`);

const { draft, warnings } = parser.parse(pages);
const leer = (value) => (value === null || value === '' ? '–' : value);
console.log(`\nEntwurf:`);
console.log(`  Veranstalter  ${leer(draft.organizer)}`);
console.log(`  Vorgang       ${leer(draft.reference)}`);
console.log(`  Reise         ${leer(draft.title)} · ${leer(draft.startsOn)} bis ${leer(draft.endsOn)}`);
console.log(`  Kundin/Kunde  ${leer(draft.customer.displayName)}`);
console.log(`  Reisende      ${draft.participants.length}`);
console.log(`  Reiseplan     ${draft.items.length} Einträge${draft.items.length ? `: ${[...new Set(draft.items.map((i) => i.kind))].join(', ')}` : ''}`);
console.log(`  Zahlungen     ${draft.payments.length} · Aufgaben ${draft.tasks.length} · Kontakte ${draft.contacts.length}`);
console.log(`Warnungen: ${warnings.length ? '' : 'keine'}`);
for (const warning of warnings) console.log(`  ⚠ ${warning}`);
if (args.includes('--json')) console.log(JSON.stringify(draft, null, 2));
console.log();
