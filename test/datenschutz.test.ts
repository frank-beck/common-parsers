import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { pruefe } from '../scripts/datenschutz.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const datei = (path: string, text: string) => ({ path, content: Buffer.from(text) });
// Echt aussehende Werte zusammengesetzt, sonst sperrt die Prüfung diese Datei selbst.
const j = (...parts: string[]) => parts.join('');
const probleme = (path: string, text: string, echt: string[] = []) => pruefe([datei(path, text)], echt).map((b) => b.problem);

describe('Datenschutz-Sperre', () => {
  it('lässt das Repository durch', () => {
    // Läuft auch in CI. Lokal zusätzlich mit privat/ersetzen.txt, falls vorhanden.
    execFileSync(process.execPath, [join(root, 'scripts/datenschutz.mjs')], { cwd: root, stdio: 'pipe' });
  });

  it('erlaubt Belegdateien nur als test/fixtures/*-muster.*', () => {
    assert.deepEqual(probleme('test/fixtures/aida-muster.pdf', '%PDF'), []);
    assert.match(probleme('test/fixtures/Rechnung Schmidt.pdf', '%PDF')[0] ?? '', /außerhalb/);
    assert.match(probleme('beleg.png', '')[0] ?? '', /außerhalb/);
    assert.match(probleme('privat/beleg.txt', '')[0] ?? '', /privat/);
  });

  it('findet Angaben aus privat/ersetzen.txt, egal in welcher Schreibweise', () => {
    assert.match(probleme('test/aida.test.ts', "const name = 'PETRA SCHMIDT';", ['Schmidt'])[0] ?? '', /ersetzen\.txt/);
    assert.deepEqual(probleme('test/aida.test.ts', "const name = 'ERIKA MUSTERFRAU';", ['Schmidt']), []);
    // Ganze Wörter: ein kurzer Vorname sperrt nicht jedes Wort, das so anfängt.
    assert.deepEqual(probleme('a.txt', 'Maximal 2 Gepäckstücke', ['Max']), []);
    assert.equal(probleme('a.txt', 'Reisende: Beispiel, Max', ['Max']).length, 1);
  });

  it('lässt nur erfundene oder freigegebene E-Mail-Domains durch', () => {
    assert.deepEqual(probleme('a.txt', 'erika@example.com max@reise.test fragenvorderreise@tui.de tui-deutschland@1.0.0'), []);
    assert.match(probleme('a.txt', j('Kontakt: petra.schmidt@', 'gmx.de'))[0] ?? '', /gmx\.de/);
  });

  it('erkennt echte IBANs und Mobilnummern, nicht die erfundenen', () => {
    assert.match(probleme('a.txt', j('IBAN DE89 3704 ', '0044 0532 0130 00'))[0] ?? '', /gültige IBAN/);
    assert.deepEqual(probleme('a.txt', 'IBAN DE00 1234 5678 9012 3456 78'), []);
    assert.match(probleme('a.txt', j('Mobil 017', '1 1234567'))[0] ?? '', /Mobilnummer/);
    assert.match(probleme('a.txt', j('Tel +49 15', '2 23456789'))[0] ?? '', /Mobilnummer/);
    assert.deepEqual(probleme('a.txt', 'Tel: +49 700 1234567, Fax 07131 123456'), []);
  });
});
