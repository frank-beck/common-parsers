import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { PdfPage } from '../src/core/pdf-text.js';
import { genericParser } from '../src/parsers/generic.js';

const pages = (...texts: string[]): PdfPage[] => texts.map((text, index) => ({ pageNumber: index + 1, text }));

describe('Beleg ohne Parserfamilie', () => {
  it('lehnt nicht ab, sondern zeigt was gefunden wurde', () => {
    const { draft, warnings } = genericParser.parse(
      pages('Hotelrechnung\nAnreise 04.11.2026\nAbreise 11.11.2026\nGesamt 1.410,00 EUR\nBuchungsnummer: HT-99017')
    );
    assert.match(warnings[0]!, /keine Parserfamilie/);
    assert.ok(warnings.some((warnung) => warnung.includes('04.11.2026') && warnung.includes('11.11.2026')));
    assert.ok(warnings.some((warnung) => warnung.includes('1.410,00 EUR')));
    assert.equal(draft.reference, 'HT-99017');
    // Es wird nichts geraten: kein Reisebeginn, kein Ablauf, keine Fristen.
    assert.equal(draft.startsOn, null);
    assert.equal(draft.items.length, 0);
    assert.equal(draft.tasks.length, 0);
  });

  it('bleibt hinter jedem echten Treffer zurueck', () => {
    assert.equal(genericParser.detect(pages('TUI Cruises Reisebestätigung / Rechnung')), 0);
  });
});
