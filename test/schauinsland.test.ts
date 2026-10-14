import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { selectParser } from '../src/core/select.js';
import { EXCERPT_MAX } from '../src/core/text.js';
import { parsers } from '../src/parsers/index.js';
import { schauinslandParser } from '../src/parsers/schauinsland.js';
import { musterPages } from './muster.js';

// Erfundener Beleg. Nie echte Namen, Nummern, Adressen — das Repository ist öffentlich.
const pages = musterPages('schauinsland-muster.txt');
const { draft, warnings } = schauinslandParser.parse(pages);
const variant = (from: string | RegExp, to: string) => pages.map((page) => ({ ...page, text: page.text.replace(from, to) }));

describe('Schauinsland-Reisen', () => {
  it('erkennt den Beleg', () => {
    assert.equal(selectParser(parsers, pages)?.parser.id, 'schauinsland');
  });

  it('greift nicht bei fremden Belegen', () => {
    for (const file of ['fremd-muster.txt', 'tui-rbe-muster.txt', 'dertour-angebot-muster.txt']) {
      assert.ok(schauinslandParser.detect(musterPages(file)) < 0.8, file);
    }
  });

  it('liest Vorgang und Reisedaten', () => {
    assert.equal(draft.reference, '9999991');
    assert.equal(draft.bookingDate, '2026-08-05');
    assert.equal(draft.summary, 'Reisebestätigung/Rechnung vom 22.09.2026');
    assert.equal(draft.startsOn, '2026-10-08');
    assert.equal(draft.endsOn, '2026-10-11');
    assert.equal(draft.title, 'Nea Potidea · Istion Club');
    assert.equal(draft.destinationCountry, 'Griechenland');
    assert.equal(draft.destinationTimeZone, 'Europe/Athens');
    assert.deepEqual(warnings, []);
  });

  it('Reisende mit zweistelligem Geburtsjahr, Kundschaft aus dem Kundenblock', () => {
    assert.deepEqual(
      draft.participants.map((p) => [p.displayName, p.kind, p.birthDate]),
      [['Erika Lisa Mustermann', 'PRIMARY', '1973-01-01']]
    );
    assert.deepEqual(draft.customer, {
      displayName: 'Erika Lisa Mustermann',
      email: null,
      phone: '+49 000 1111111',
      address: 'Musterstraße 3, 12345 Musterstadt'
    });
  });

  it('Kundenblock: Name hinter „Kunde:“, PLZ mit Länderkennung', () => {
    const inline = schauinslandParser.parse(variant(/Kunde:\nMustermann Erika\nMusterstraße 3\n12345 Musterstadt/g, 'Kunde: Mustermann Erika\nMusterstraße 3\nD-12345 Musterstadt'));
    assert.deepEqual([inline.draft.customer.displayName, inline.draft.customer.address], ['Erika Lisa Mustermann', 'Musterstraße 3, 12345 Musterstadt']);
    assert.deepEqual(inline.warnings, []);
  });

  it('ohne Kundenblock: erste Reisende ist Kundschaft, mit Warnung', () => {
    const missing = schauinslandParser.parse(variant(/Kunde:\n/g, ''));
    assert.deepEqual([missing.draft.customer.displayName, missing.draft.customer.address], ['Erika Lisa Mustermann', null]);
    assert.deepEqual(missing.warnings, ['Kundenblock „Kunde:“ nicht erkannt — erste Reisende als Kundschaft übernommen, Anschrift fehlt.']);
  });

  it('Kind über Anrede oder Alter', () => {
    const family = schauinslandParser.parse(
      variant('FRAU Erika Lisa Mustermann 01.01.73', 'FRAU Erika Lisa Mustermann 01.01.73\nHERR Max Mustermann 01.01.70\nKIND Mia Mustermann 01.01.18\nHERR Tom Mustermann 01.01.10')
    );
    assert.deepEqual(
      family.draft.participants.map((p) => [p.displayName, p.kind, p.birthDate]),
      [
        ['Erika Lisa Mustermann', 'PRIMARY', '1973-01-01'],
        ['Max Mustermann', 'COMPANION', '1970-01-01'],
        ['Mia Mustermann', 'CHILD', '2018-01-01'],
        ['Tom Mustermann', 'CHILD', '2010-01-01']
      ]
    );
  });

  it('liest den Reiseplan mit Flugzeiten aus der Leistungstabelle', () => {
    assert.deepEqual(
      draft.items.map((item) => [item.kind, item.date, item.endDate, item.title, item.subtitle]),
      [
        ['FLIGHT', '2026-10-08', '2026-10-08', 'Hinflug Stuttgart → Thessaloniki', 'EW2680 · Eurowings · Economy'],
        ['HOTEL', '2026-10-08', '2026-10-11', 'Istion Club', 'Doppelzimmer=Einzelzimmer · Halbpension'],
        ['FLIGHT', '2026-10-11', '2026-10-11', 'Rückflug Thessaloniki → Stuttgart', 'A30510 · Aegean Airlines · Economy']
      ]
    );
    const [outbound, hotel] = draft.items;
    assert.deepEqual(
      [outbound?.startTime, outbound?.endTime, outbound?.location, outbound?.description],
      ['05:50', '09:00', 'Thessaloniki (SKG)', 'Freigepäck je Person: 1 Gepäckstück']
    );
    assert.deepEqual([hotel?.location, hotel?.description], ['Nea Potidea', '1 Doppelzimmer=Einzelzimmer, 1 Erwachsener · Ohne Transfer']);
    assert.ok(draft.items.every((item) => item.statusLabel === 'Bestätigt'));
  });

  it('Fundstellen bleiben unter dem NADIA-Limit', () => {
    const excerpts = [...draft.items, ...draft.tasks, ...draft.payments].map((entry) => entry.evidence?.excerpt ?? '');
    assert.ok(excerpts.every((excerpt) => excerpt.length <= EXCERPT_MAX + 2));
  });

  it('Web-Check-in je Airline, Aegean mit Buchstabencode', () => {
    assert.deepEqual(
      draft.tasks.map((t) => [t.title, t.dueOn, t.rule, t.required, t.travelerVisible]),
      [
        ['Web-Check-in Eurowings: Hinflug', '2026-10-05', 'ab 72 Stunden vor Abflug', true, true],
        ['Web-Check-in Aegean: Rückflug', '2026-10-09', 'ab 48 Stunden vor Abflug', false, true]
      ]
    );
    assert.match(draft.tasks[0]?.description ?? '', /kostenpflichtig \(20 Euro pro Person und Strecke\)/);
    assert.match(draft.tasks[1]?.description ?? '', /Buchungsnummer für Aegean: I999991\./);
  });

  it('voll bezahlt: nur Gesamtpreis, keine offenen Posten', () => {
    assert.deepEqual(
      draft.payments.map((p) => [p.kind, p.amountCents, p.dueOn]),
      [['TOTAL', 61700, null]]
    );
    assert.ok(draft.notes.includes('Laut Beleg bereits bezahlt: 617,00 EUR.'));
  });

  it('offen: Anzahlung mit Fälligkeit, Restzahlung mit Warnung', () => {
    const open = schauinslandParser.parse(variant('Bereits geleistete Zahlung: 617.00 EUR.', 'Bereits geleistete Zahlung: 0.00 EUR.'));
    assert.deepEqual(
      open.draft.payments.map((p) => [p.kind, p.amountCents, p.dueOn]),
      [
        ['TOTAL', 61700, null],
        ['DEPOSIT', 15500, '2026-09-22'],
        ['BALANCE', 46200, null]
      ]
    );
    assert.deepEqual(open.warnings, ['Restzahlung ohne Fälligkeit im Beleg — Termin eintragen.']);
    assert.ok(open.draft.tasks.some((t) => t.title === 'Anzahlung fällig' && t.dueOn === '2026-09-22' && !t.travelerVisible));
  });

  it('Leistungen, Hinweise, Kontakte', () => {
    assert.deepEqual(draft.inclusions, ['Halbpension', 'Rail & Fly']);
    assert.deepEqual(draft.notes, [
      'Laut Beleg bereits bezahlt: 617,00 EUR.',
      'Ohne Transfer Flughafen-Hotel-Flughafen.',
      'Keine Reiserücktrittskostenversicherung über Schauinsland gebucht.',
      'Griechenland: Klimaabgabe vor Ort, je Zimmer und Tag nach Hotelkategorie.'
    ]);
    assert.deepEqual(
      draft.contacts.map((c) => [c.kind, c.name, c.phone, c.address]),
      [
        ['ADVISOR', 'Reisebüro Muster GmbH', '+49 000 1111111', 'Musterstraße 2, 12345 Musterstadt'],
        ['OTHER', 'Schauinsland-Reisen GmbH', null, 'Musterstraße 1, 12345 Musterstadt'],
        ['HOTEL', 'Istion Club', null, 'Nea Potidea']
      ]
    );
  });

  it('Reisebüro auch mit Länderkennung, zweizeiliger Anschrift, „Tel:“', () => {
    const office = schauinslandParser.parse(
      variant(/Reisebüro Muster GmbH\nMusterstraße 2\n12345 Musterstadt\nTel\.: /g, 'Reisebüro Muster GmbH\nFiliale Mitte\nMusterstraße 2\nD-12345 Musterstadt\nTel: ')
    );
    const advisor = office.draft.contacts.find((c) => c.kind === 'ADVISOR');
    assert.deepEqual(
      [advisor?.name, advisor?.phone, advisor?.address],
      ['Reisebüro Muster GmbH', '+49 000 1111111', 'Filiale Mitte, Musterstraße 2, 12345 Musterstadt']
    );
    assert.deepEqual(office.warnings, []);
  });

  it('Kennwort für mein-schauinsland landet nirgends im Entwurf', () => {
    assert.ok(!JSON.stringify(draft).includes('Kennwort'));
  });
});
