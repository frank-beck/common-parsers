import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MIN_TEXT_CHARS, joinedText, normalizeItems, textCharacters, type PdfPage } from '../src/core/pdf-text.js';

/** Textfragment, wie pdfjs es liefert: Position und Breite entscheiden über Leerzeichen. */
const fragment = (str: string, x: number, width: number, hasEOL = false) => ({
  str,
  width,
  hasEOL,
  transform: [1, 0, 0, 1, x, 700]
});

const fixture = (name: string) => resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', name);

/** So liest die App: pdfjs-Textschicht, je Seite durch normalizeItems. */
async function readPages(path: string): Promise<PdfPage[]> {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true }).promise;
  try {
    const pages: PdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push({ pageNumber, text: normalizeItems(content.items) });
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

describe('PDF-Textaufbereitung', () => {
  it('klebt zerlegte Ligaturen wieder zusammen', () => {
    // TUI legt "Hinflug" als drei Fragmente ohne Lücke ab.
    const text = normalizeItems([fragment('Hin', 94.3, 12.3), fragment('fl', 106.6, 4.7), fragment('ug', 111.3, 8.5)]);
    assert.equal(text, 'Hinflug');
  });

  it('behält echte Wortgrenzen', () => {
    const text = normalizeItems([fragment('Reisebeginn', 80, 40), fragment(' ', 120, 3), fragment('flexibel', 124, 28)]);
    assert.equal(text, 'Reisebeginn flexibel');
  });

  it('trennt Spalten derselben Zeile', () => {
    // Der Wert steht links vom Etikett: pdfjs springt zurück.
    const text = normalizeItems([fragment('Mein Schiff 1', 188.1, 42.9), fragment('Ihr Schiff:', 111.1, 33.7)]);
    assert.equal(text, 'Mein Schiff 1 Ihr Schiff:');
  });
});

describe('PDF-Textschicht lesen', () => {
  // Lädt pdfjs wirklich. Ohne diesen Test prüfte hier nur normalizeItems mit
  // erfundenen Fragmenten, nie die echte Ausgabe von pdfjs.
  it('liest einen Beleg mit Textschicht', async () => {
    const seiten = await readPages(fixture('beleg-muster.pdf'));
    assert.equal(seiten.length, 1);
    const text = joinedText(seiten);
    assert.match(text, /Vorgangsnummer MR-2026-7788/);
    assert.match(text, /Erika Musterfrau/);
    assert.match(text, /Restzahlung faellig am 28\.10\.2026/);
    assert.ok(textCharacters(seiten) >= MIN_TEXT_CHARS);
  });

  it('erkennt den eingescannten Beleg an fehlendem Text', async () => {
    // Die App schickt so einen Beleg durch die Texterkennung.
    const seiten = await readPages(fixture('scan-muster.pdf'));
    assert.ok(textCharacters(seiten) < MIN_TEXT_CHARS);
  });
});
