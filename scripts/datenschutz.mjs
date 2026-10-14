// Sperre gegen echte Kundendaten. Dieses Repository ist öffentlich.
//
//   node scripts/datenschutz.mjs            alle Dateien im Arbeitsverzeichnis (ohne .gitignore)
//   node scripts/datenschutz.mjs --staged   was gerade committet wird (.githooks/pre-commit)
//
// Prüft:
// - Belegdateien (PDF, Bilder, Office, Mails) nur als test/fixtures/*-muster.<endung>
// - nichts unter privat/ (geht nur mit `git add -f`)
// - keine Angabe aus privat/ersetzen.txt (linke Seite: echte Namen, Nummern, Adressen)
// - E-Mail-Adressen nur mit erfundener Domain oder aus ERLAUBTE_DOMAINS
// - keine gültige IBAN, keine Mobilnummer
// - unter test/: Namen, Geburtsdaten, Anschriften, Telefon nur aus dem Pool (scripts/testdaten.mjs)
//
// Was sie nicht findet: echte Daten, die nicht in privat/ersetzen.txt stehen und
// keinem Muster folgen — ein Name, ein Geburtsdatum. Darum bleibt das Lesen
// vor dem Commit Pflicht (docs/neuer-parser.md, Schritt 4).
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NUR_GEGENBEISPIELE, pruefeTestdaten } from './testdaten.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Firmenadressen von Veranstaltern, die ein Parser kennen darf. Personen nie. */
export const ERLAUBTE_DOMAINS = ['tui.de'];

const BELEGDATEI = /\.(pdf|png|jpe?g|gif|heic|webp|tiff?|docx?|xlsx?|odt|eml|msg|zip)$/i;
const ERFUNDEN = /(^|\.)(example\.(com|org|net)|example|test|invalid)$/i;
// Endung aus Buchstaben: `tui-deutschland@1.0.0` ist keine Adresse.
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const MOBIL = /(?:\+49[\s/-]?|\b0)1[5-7]\d[\s/-]?\d{3,4}[\s/-]?\d{3,5}\b/g;
const OHNE_INHALTSPRUEFUNG = new Set(['package-lock.json', 'scripts/datenschutz.mjs']);

/** Prüfsumme nach ISO 13616. Erfundene IBANs (falsche Prüfziffer) kommen durch. */
function gueltigeIban(raw) {
  const iban = raw.replace(/\s/g, '');
  const umgestellt = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ziffer of umgestellt) rest = (rest * 10 + Number(ziffer)) % 97;
  return rest === 1;
}

/** Ganzes Wort, Groß/klein egal: „Max“ trifft nicht „Maximal“. */
export function alsWort(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Linke Seiten aus privat/ersetzen.txt (`echt = erfunden`). */
export function echteAngaben(path = join(root, 'privat/ersetzen.txt')) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.split('=')[0].trim())
    .filter((value) => value.length >= 3 && !value.startsWith('#'));
}

/**
 * @param {{ path: string, content: Buffer }[]} files
 * @param {string[]} echt
 * @returns {{ path: string, line: number | null, problem: string }[]}
 */
export function pruefe(files, echt = []) {
  const befunde = [];
  const melde = (path, line, problem) => befunde.push({ path, line, problem });
  for (const { path, content } of files) {
    if (path.startsWith('privat/')) {
      melde(path, null, 'privat/ gehört nie ins Repository');
      continue;
    }
    if (BELEGDATEI.test(path)) {
      if (!/^test\/fixtures\/[a-z0-9-]+-muster\.[a-z]+$/.test(path)) {
        melde(path, null, 'Belegdatei außerhalb von test/fixtures/*-muster.* — echter Beleg? Nach privat/ verschieben');
      }
      continue;
    }
    if (OHNE_INHALTSPRUEFUNG.has(path) || content.includes(0)) continue;
    const lines = content.toString('utf8').split('\n');
    const muster = echt.map((value) => [value, alsWort(value)]);
    lines.forEach((text, index) => {
      const line = index + 1;
      for (const [value, pattern] of muster) {
        if (pattern.test(text)) melde(path, line, `„${value}“ steht in privat/ersetzen.txt (echte Angabe)`);
      }
      for (const [, domain] of text.matchAll(EMAIL)) {
        if (!ERFUNDEN.test(domain) && !ERLAUBTE_DOMAINS.includes(domain.toLowerCase())) {
          melde(path, line, `E-Mail mit echter Domain ${domain} — erfunden: …@example.com; Veranstalteradresse: ERLAUBTE_DOMAINS in scripts/datenschutz.mjs`);
        }
      }
      for (const [iban] of text.matchAll(IBAN)) {
        if (gueltigeIban(iban)) melde(path, line, `gültige IBAN ${iban} — erfunden: DE00 1234 5678 9012 3456 78`);
      }
      for (const [nummer] of text.matchAll(MOBIL)) {
        melde(path, line, `Mobilnummer ${nummer.trim()} — erfunden: +49 000 1111111`);
      }
    });
    if (path.startsWith('test/') && !NUR_GEGENBEISPIELE.has(path)) {
      const text = content.toString('utf8');
      for (const { index, problem } of pruefeTestdaten(text)) {
        melde(path, text.slice(0, index).split('\n').length, problem);
      }
    }
  }
  return befunde;
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
}

function dateien(staged) {
  if (staged) {
    const paths = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').toString('utf8').split('\0').filter(Boolean);
    return paths.map((path) => ({ path, content: git('show', `:${path}`) }));
  }
  const paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').toString('utf8').split('\0').filter(Boolean);
  // Nur echte Dateien: gelöschte, Ordner und Symlinks (z. B. node_modules als Link) fallen raus.
  return paths.filter((path) => existsSync(join(root, path)) && lstatSync(join(root, path)).isFile()).map((path) => ({ path, content: readFileSync(join(root, path)) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const staged = process.argv.includes('--staged');
  const befunde = pruefe(dateien(staged), echteAngaben());
  if (befunde.length) {
    console.error(`\n✗ Datenschutz: ${befunde.length} Fund(e)${staged ? ' — Commit abgebrochen' : ''}\n`);
    for (const { path, line, problem } of befunde) console.error(`  ${path}${line ? `:${line}` : ''}  ${problem}`);
    console.error('\nAnleitung: docs/neuer-parser.md, Abschnitt Datenschutz\n');
    process.exit(1);
  }
  console.log(`Datenschutz: ok${echteAngaben().length ? '' : ' (privat/ersetzen.txt fehlt — echte Namen werden nicht geprüft)'}`);
}
