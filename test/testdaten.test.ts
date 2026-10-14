import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { POOL, pruefeTestdaten } from '../scripts/testdaten.mjs';

// Gegenbeispiele: echt aussehende Werte, die die Prüfung finden muss (NUR_GEGENBEISPIELE).
const funde = (text: string) => pruefeTestdaten(text).map((fund) => fund.problem);

describe('Testdaten aus dem Pool', () => {
  it('lässt Pool-Werte durch', () => {
    const text = [
      'Hallo Herr Max Mustermann,',
      '1 Frau Erika Musterfrau (01.01.1970)',
      '5 Kind Mia Muster (01.01.2016)',
      '3 Kind Tba Tbac 15/01.01.2012',
      'Ticket MUSTERMANN/MAX PETER',
      'Musterstraße 1',
      'D - 12345 Musterstadt',
      `Telefon: ${POOL.telefon} · Mobil: +49 (0)000 1111110`,
      'TUI Deutschland GmbH · Karl-Wiechert-Allee 23 · DE - 30625 Hannover',
      'IBAN: DE00 1234 5678 9012 3456 78 · SWIFT/BIC: COBADEFFXXX',
      'Steuernr.: 12345/67890',
      'Gesamtpreis 18.977,00 € · 0,00 € · PG 0275, 07.03.2027 12:00 Uhr',
      'BEIBLATT ZUR REISEBESTÄTIGUNG/RECHNUNG',
      'Seite: 0002 1 / 5'
    ].join('\n');
    assert.deepEqual(funde(text), []);
  });

  it('findet Namen außerhalb des Pools, auch Kinder und Tickets', () => {
    assert.match(funde('5 Kind Hannelore Mustermann (01.01.2016)')[0] ?? '', /Hannelore/);
    assert.match(funde('Hallo Frau Petra Schmidt,')[0] ?? '', /Petra Schmidt/);
    assert.match(funde('Ticket SCHMIDT/PETRA')[0] ?? '', /SCHMIDT PETRA/);
  });

  it('findet Geburtsdaten, Anschriften, Telefon außerhalb des Pools', () => {
    assert.match(funde('2 Herr Max Mustermann (12.04.1981)')[0] ?? '', /Geburtsdatum 12\.04\.1981/);
    assert.match(funde('4 Kind Tba Tbad 13/17.02.2014')[0] ?? '', /Geburtsdatum 17\.02\.2014/);
    assert.match(funde('D - 99999 Irgendwo')[0] ?? '', /99999 Irgendwo/);
    assert.match(funde('Telefon: +49 (0)7000 555666')[0] ?? '', /Telefon/);
    assert.match(funde('Tel: 0711 1234567')[0] ?? '', /Telefon/);
  });
});
