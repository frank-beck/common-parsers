// Gerüst für einen neuen Parser.
//
//   npm run neu -- aida "AIDA Cruises"
//
// Legt an: src/parsers/<id>.ts, test/<id>.test.ts, test/fixtures/<id>-muster.txt
// und trägt den Parser in src/parsers/index.ts und scripts/entries.mjs ein.
// Die Tests sind danach rot — das ist richtig, sie beschreiben, was fehlt.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [id, family] = process.argv.slice(2);
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (!id || !family) fail('Aufruf: npm run neu -- <id> "<Veranstalter>"   z. B. npm run neu -- aida "AIDA Cruises"');
if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) fail(`id "${id}": nur Kleinbuchstaben, Ziffern, Bindestrich (z. B. aida, dertour-hotel)`);
const name = `${id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}Parser`;
const files = {
  parser: join(root, `src/parsers/${id}.ts`),
  test: join(root, `test/${id}.test.ts`),
  muster: join(root, `test/fixtures/${id}-muster.txt`),
  index: join(root, 'src/parsers/index.ts'),
  entries: join(root, 'scripts/entries.mjs')
};
if (existsSync(files.parser)) fail(`src/parsers/${id}.ts gibt es schon`);
const quoted = JSON.stringify(family).slice(1, -1).replaceAll("'", "\\'");

writeFileSync(
  files.parser,
  `import type { DocumentParser } from '../core/draft.js';
import { emptyDraft } from '../core/draft.js';
import { joinedText } from '../core/pdf-text.js';
import { germanDate, matchFirst } from '../core/text.js';

/**
 * ${family}. Muster: test/fixtures/${id}-muster.txt (erfunden).
 * Anleitung und Fallen: docs/neuer-parser.md, Vertrag: docs/vertrag.md
 */
export const ${name}: DocumentParser = {
  id: '${id}',
  version: '1.0.0',
  family: '${quoted}',
  label: '${quoted} — Buchungsbestätigung',
  detect(pages) {
    const text = joinedText(pages);
    // TODO: was nur in diesen Belegen steht — Firmenname und Belegart.
    if (!/TODO Firmenname/i.test(text)) return 0;
    return /TODO Belegart/i.test(text) ? 0.95 : 0.6;
  },
  parse(pages) {
    const draft = emptyDraft();
    const warnings: string[] = [];
    draft.organizer = '${quoted}';
    // TODO: Muster an den Text in test/fixtures/${id}-muster.txt anpassen.
    draft.reference = matchFirst(pages, /Buchungsnummer:\\s*([A-Z0-9-]{4,20})/)?.value ?? null;
    if (!draft.reference) warnings.push('Keine Buchungsnummer erkannt.');
    draft.startsOn = germanDate(matchFirst(pages, /Reisebeginn:\\s*(\\d{1,2}\\.\\d{1,2}\\.\\d{4})/)?.value);
    draft.endsOn = germanDate(matchFirst(pages, /Reiseende:\\s*(\\d{1,2}\\.\\d{1,2}\\.\\d{4})/)?.value);
    if (!draft.startsOn) warnings.push('Kein Reisebeginn erkannt.');
    return { draft, warnings };
  }
};
`
);

writeFileSync(
  files.test,
  `import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { selectParser } from '../src/core/select.js';
import { parsers } from '../src/parsers/index.js';
import { ${name} } from '../src/parsers/${id}.js';
import { musterPages } from './muster.js';

// Erfundener Beleg. Nie echte Namen, Nummern, Adressen — das Repository ist öffentlich.
const pages = musterPages('${id}-muster.txt');

describe('${quoted}', () => {
  it('erkennt den Beleg', () => {
    assert.equal(selectParser(parsers, pages)?.parser.id, '${id}');
  });

  it('greift nicht bei fremden Belegen', () => {
    for (const other of [musterPages('fremd-muster.txt')]) assert.ok(${name}.detect(other) < 0.8);
  });

  it('liest Vorgang und Reisedaten', () => {
    const { draft, warnings } = ${name}.parse(pages);
    // TODO: Werte aus test/fixtures/${id}-muster.txt eintragen
    assert.equal(draft.reference, 'TODO');
    assert.equal(draft.startsOn, 'JJJJ-MM-TT');
    assert.equal(draft.endsOn, 'JJJJ-MM-TT');
    assert.deepEqual(warnings, []);
  });
});
`
);

writeFileSync(
  files.muster,
  `=== Seite 1 ===
Hier den Inhalt von privat/<beleg>.muster.txt einfügen — erst NACH dem Prüfen (Schritt 4).
Jede Seite beginnt mit einer Zeile wie oben.
`
);

const index = readFileSync(files.index, 'utf8');
const imports = [...index.matchAll(/^import .*;$/gm)];
const lastImport = imports.at(-1);
let nextIndex = `${index.slice(0, lastImport.index + lastImport[0].length)}\nimport { ${name} } from './${id}.js';${index.slice(lastImport.index + lastImport[0].length)}`;
// Vor dem Auffangparser einreihen; die Reihenfolge entscheidet nur bei gleicher Wertung.
nextIndex = nextIndex.replace(/(export const parsers: readonly DocumentParser\[\] = \[)([^\]]*?)(genericParser\])/, `$1$2${name}, $3`);
if (!nextIndex.includes(`${name}, genericParser]`)) fail('src/parsers/index.ts: Liste nicht gefunden — von Hand eintragen');
writeFileSync(files.index, nextIndex);

const entries = readFileSync(files.entries, 'utf8');
const nextEntries = entries.replace(/^(\s*)generic:/m, `$1'${id}': 'src/parsers/${id}.ts#${name}',\n$1generic:`);
if (nextEntries === entries) fail('scripts/entries.mjs: Eintrag "generic" nicht gefunden — von Hand eintragen');
writeFileSync(files.entries, nextEntries);

console.log(`Angelegt:
  src/parsers/${id}.ts              Parser (${name})
  test/${id}.test.ts                Tests — jetzt rot, das ist richtig
  test/fixtures/${id}-muster.txt    hier kommt der erfundene Beleg hin
Eingetragen in src/parsers/index.ts und scripts/entries.mjs.

Weiter: docs/neuer-parser.md, Schritt 6`);
