import type { DocumentParser, ParseResult } from '../core/draft.js';
import { emptyDraft } from '../core/draft.js';
import type { PdfPage } from '../core/pdf-text.js';
import { germanDate } from '../core/text.js';

/**
 * Der Weg für Belege, für die es keine Parserfamilie gibt — Hotelbestätigungen,
 * Mietwagen, AIDA, alles Direktgebuchte.
 *
 * Er **rät nicht**. Ein Hotelbeleg nennt fünf Daten, und welches davon die
 * Anreise ist, steht nirgends maschinenlesbar. Ein falsch geratener Reisebeginn
 * ist schlimmer als gar keiner: er sieht richtig aus.
 *
 * Stattdessen legt er den Beleg ab, hält den erkannten Text fest und zeigt der
 * Beratung, was gefunden wurde — Daten, Beträge, Buchungsnummern. Zuordnen tut
 * sie selbst. Das ist der Normalfall beim Ergänzen einer bestehenden Reise,
 * wo Kundin, Vorgangsnummer und Ziel ohnehin feststehen.
 */

const DATUM = /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/g;
const BETRAG = /\b\d{1,3}(?:\.\d{3})*,\d{2}\s?(?:EUR|€)/g;
// Das schliessende \b hinter der Wortgruppe ist entscheidend: ohne es greift
// bei "Buchungsnummer: X" die kurze Alternative "Buchung", und das uebrige
// "snummer:" laesst das Muster scheitern.
const NUMMER =
  /\b(?:Buchungs?(?:nummer|nr)?|Reservierungs?(?:nummer|nr)?|Vorgangs?(?:nummer|nr)?|Referenz|Booking(?:\s+(?:number|ref))?|Confirmation(?:\s+(?:number|code))?)\b[^\S\n]*[:.#]?[^\S\n]*([A-Z0-9][A-Z0-9-]{4,19})\b/gi;

function einmalig(werte: readonly string[], grenze: number): string[] {
  return [...new Set(werte)].slice(0, grenze);
}

export const genericParser: DocumentParser = {
  id: 'generic',
  version: '1.0.0',
  family: 'Ohne Familie',
  label: 'Beleg ohne bekannte Veranstalterfamilie',
  fallback: true,

  // Greift nie von selbst. Die App setzt ihn ein, wenn sonst keiner passt;
  // ein echter Treffer muss immer Vorrang haben.
  detect() {
    return 0;
  },

  parse(pages: readonly PdfPage[]): ParseResult {
    const draft = emptyDraft();
    const text = pages.map((seite) => seite.text).join('\n');
    const warnings: string[] = [
      'Für diesen Beleg gibt es keine Parserfamilie — Ablauf, Fristen und Kontakte werden nicht automatisch erzeugt. Der Beleg wird abgelegt; trage ein, was gebraucht wird.'
    ];

    const daten = einmalig(
      [...text.matchAll(DATUM)].map((treffer) => treffer[0]).filter((wert) => germanDate(wert)),
      12
    );
    if (daten.length) {
      warnings.push(`Gefundene Datumsangaben: ${daten.join(', ')}.`);
    }

    const betraege = einmalig([...text.matchAll(BETRAG)].map((treffer) => treffer[0]), 6);
    if (betraege.length) {
      warnings.push(`Gefundene Beträge: ${betraege.join(', ')}.`);
    }

    const nummern = einmalig(
      [...text.matchAll(NUMMER)].map((treffer) => treffer[1]!).filter((wert) => /\d/.test(wert)),
      4
    );
    if (nummern.length) {
      warnings.push(`Mögliche Buchungsnummern: ${nummern.join(', ')}.`);
      // Als Vorschlag, nicht als Festlegung: Beim Anlegen einer neuen Reise
      // steht die Nummer im Feld und kann überschrieben werden.
      draft.reference = nummern[0] ?? null;
    }

    return { draft, warnings };
  }
};
