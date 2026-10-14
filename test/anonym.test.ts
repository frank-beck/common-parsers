import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { ersetze, ersetzungen } from '../scripts/anonym.mjs';
import { emptyDraft } from '../src/core/draft.js';

// Erfunden. Steht für einen echten Beleg, wie `npm run lesen -- … --anonym` ihn sieht.
const text = `=== Seite 1 ===
TUI Deutschland GmbH · Karl-Wiechert-Allee 23 · 30625 Hannover
Hanna Beispielhaft
Lindenweg 5
99999 Irgendwo
Hallo Frau Hanna Beispielhaft,
Buchung: 12345678 | Datum: 01.09.2026
1 Frau Hanna Beispielhaft (01.02.1980)
2 Herr Jonas Beispielhaft (03.04.1979)
3 Kind Tba Tbac
5 Kind Lotta Beispielhaft (14.06.2016)
Am Tal 16/1
D - 88888 Nirgendwo
Telefon Mobil: +49 (0)7000 555666
Steuernr.: 11111/22222
Ticket BEISPIELHAFT/HANNA 2201234567890
Telefon: 0711 1234567 · E-Mail: hanna@example.org
IBAN: DE12 3456 7890 1234 5678 90
15.03.2027 Hinflug Frankfurt (FRA) > Bangkok (BKK) DE2574 Gesamtpreis: 3.170,00 €
Katathani Phuket Beach Resort
`;

const draft = emptyDraft();
draft.customer.displayName = 'Hanna Beispielhaft';
draft.participants = [
  { displayName: 'Hanna Beispielhaft', birthDate: '1980-02-01', kind: 'PRIMARY' },
  { displayName: 'Jonas Beispielhaft', birthDate: '1979-04-03', kind: 'COMPANION' },
  { displayName: 'Kind 3', birthDate: null, kind: 'CHILD' }
];

const paare = ersetzungen(draft, text);
const muster = ersetze(text, paare.map(({ echt, erfunden }) => [echt, erfunden]));

describe('anonym', () => {
  it('ersetzt Kundendaten', () => {
    for (const echt of [
      'Beispielhaft',
      'Hanna',
      'Jonas',
      '01.02.1980',
      '03.04.1979',
      'Lindenweg 5',
      '99999 Irgendwo',
      '12345678',
      '2201234567890',
      '0711 1234567',
      'hanna@example.org',
      'DE12 3456 7890 1234 5678 90',
      // vom Parser nicht erkannt, nur über feste Muster
      'Lotta',
      '14.06.2016',
      'Am Tal 16/1',
      '88888 Nirgendwo',
      '555666',
      '11111/22222'
    ]) {
      assert.ok(!muster.toLowerCase().includes(echt.toLowerCase()), `${echt} steht noch im Muster:\n${muster}`);
    }
  });

  it('lässt Veranstalter, Reisedaten, Preise, Hotels', () => {
    for (const bleibt of [
      'TUI Deutschland GmbH · Karl-Wiechert-Allee 23 · 30625 Hannover',
      'Datum: 01.09.2026',
      '15.03.2027 Hinflug Frankfurt (FRA) > Bangkok (BKK) DE2574 Gesamtpreis: 3.170,00 €',
      'Katathani Phuket Beach Resort',
      'Kind Tba Tbac'
    ]) {
      assert.ok(muster.includes(bleibt), `${bleibt} fehlt im Muster:\n${muster}`);
    }
  });

  it('gleicher Name, gleicher Ersatz; Großschreibung bleibt', () => {
    assert.match(muster, /Ticket MUSTERMANN\/MAX \d+/);
    assert.match(muster, /2 Herr Erika Mustermann \(01\.01\.1979\)/);
  });
});
