import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { euroCents, germanDate, personName, shiftDate } from '../src/core/text.js';

describe('Textwerkzeuge', () => {
  it('liest deutsche Datumsangaben', () => {
    assert.equal(germanDate('15.01.2027'), '2027-01-15');
    assert.equal(germanDate('3.7.26'), '2026-07-03');
    assert.equal(germanDate('31.02.2027'), null);
  });

  it('rechnet Fristen zurück', () => {
    assert.equal(shiftDate('2027-01-15', -6, 'week'), '2026-12-04');
    assert.equal(shiftDate('2027-01-15', -4, 'month'), '2026-09-15');
    assert.equal(shiftDate('2026-09-17', -15, 'day'), '2026-09-02');
    assert.equal(shiftDate('2027-03-31', -1, 'month'), '2027-02-28');
  });

  it('liest Eurobeträge mit deutschem Trennzeichen', () => {
    assert.equal(euroCents('14.974,86 €'), 1_497_486);
    assert.equal(euroCents('621,75 €'), 62_175);
    assert.equal(euroCents('kein Betrag'), null);
  });

  it('dreht Namen aus der Veranstalterschreibweise', () => {
    assert.equal(personName('MUSTERFRAU/ERIKA'), 'Erika Musterfrau');
    assert.equal(personName('Frau Erika Musterfrau'), 'Erika Musterfrau');
  });
});
