import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { selectParser } from '../src/core/select.js';
import { parsers } from '../src/parsers/index.js';
import { dertourAngebotParser } from '../src/parsers/dertour-angebot.js';
import { musterPages } from './muster.js';

// Erfundener Beleg. Nie echte Namen, Nummern, Adressen — das Repository ist öffentlich.
const pages = musterPages('dertour-angebot-muster.txt');
const { draft, warnings } = dertourAngebotParser.parse(pages);

describe('DERTOUR Angebot', () => {
  it('erkennt den Beleg', () => {
    assert.equal(selectParser(parsers, pages)?.parser.id, 'dertour-angebot');
  });

  it('greift nicht bei fremden Belegen', () => {
    for (const other of [musterPages('fremd-muster.txt')]) assert.ok(dertourAngebotParser.detect(other) < 0.8);
  });

  it('greift nicht bei anderen DERTOUR-Belegen', () => {
    const booked = pages.map((page) => ({ ...page, text: page.text.replaceAll(/unverbindliches Angebot/gi, 'Reisebestätigung') }));
    assert.ok(dertourAngebotParser.detect(booked) < 0.8);
  });

  it('liest Vorgang und Reisedaten', () => {
    assert.equal(draft.reference, '999888777');
    assert.equal(draft.bookingDate, null, 'Angebot ist nicht gebucht');
    assert.equal(draft.summary, 'Unverbindliches Angebot vom 22.09.2026');
    assert.equal(draft.startsOn, '2027-02-03');
    assert.equal(draft.endsOn, '2027-02-16');
    assert.equal(draft.title, 'Thailand: Bangkok, Phuket, Khao Lak');
    assert.equal(draft.destinationTimeZone, 'Asia/Bangkok');
  });

  it('liest Reisende, Platzhalter „Tba“ als Warnung', () => {
    assert.equal(draft.customer.displayName, 'Max Mustermann');
    assert.deepEqual(
      draft.participants.map((p) => [p.displayName, p.kind, p.birthDate]),
      [
        ['Max Mustermann', 'PRIMARY', null],
        ['Reisende/r 2', 'COMPANION', null],
        ['Kind 3', 'CHILD', '2012-02-03'],
        ['Kind 4', 'CHILD', '2014-02-03'],
        ['Kind 5', 'CHILD', '2017-02-03']
      ]
    );
    assert.deepEqual(warnings, ['Reisende 2, 3, 4, 5 ohne Namen (Platzhalter „Tba“) — Namen nachtragen.']);
  });

  it('liest den Reiseplan über alle Seiten', () => {
    assert.deepEqual(
      draft.items.map((item) => [item.kind, item.date, item.title]),
      [
        ['TRAIN', '2027-02-03', 'Rail & Fly 2.Klasse'],
        ['FLIGHT', '2027-02-03', 'Flug Frankfurt am Main → Bangkok Suvarnabhumi'],
        ['TRANSFER', '2027-02-04', 'Hintransfer BKK'],
        ['HOTEL', '2027-02-04', 'AVANI+ Riverside Bangkok Hotel'],
        ['FLIGHT', '2027-02-07', 'Flug Bangkok Suvarnabhumi → Phuket'],
        ['TRANSFER', '2027-02-07', 'Rücktransfer BKK'],
        ['TRANSFER', '2027-02-07', 'Hintransfer HKT'],
        ['HOTEL', '2027-02-07', 'Katathani Phuket Beach Resort'],
        ['TRANSFER', '2027-02-11', 'Zonentransfer HKT'],
        ['HOTEL', '2027-02-11', 'Khao Lak Marriott Beach Resort & Spa'],
        ['TRANSFER', '2027-02-16', 'Rücktransfer HKT'],
        ['FLIGHT', '2027-02-16', 'Flug Phuket → Frankfurt am Main']
      ]
    );
    assert.ok(draft.items.every((item) => item.statusLabel === 'Angebot'));
  });

  it('Nachtflug landet am Folgetag', () => {
    const outbound = draft.items.find((item) => item.kind === 'FLIGHT');
    assert.deepEqual(
      [outbound?.startTime, outbound?.endDate, outbound?.endTime, outbound?.subtitle],
      ['21:15', '2027-02-04', '14:20', 'DE2574 · Condor · Economy']
    );
  });

  it('fasst zwei Zimmer im selben Hotel zusammen', () => {
    const hotel = draft.items.find((item) => item.title === 'Katathani Phuket Beach Resort');
    assert.equal(hotel?.endDate, '2027-02-11');
    assert.equal(hotel?.location, 'Phuket');
    assert.equal(hotel?.subtitle, 'Grande Suite (WB1), Grand Deluxe (UD4) · Frühstück');
    assert.equal(hotel?.description, 'Grande Suite (WB1): Reisende 1, 3, 4 · Grand Deluxe (UD4): Reisende 2, 5');
  });

  it('Gesamtbetrag ohne Fälligkeit, Einreisekarte als Aufgabe', () => {
    assert.deepEqual(
      draft.payments.map((p) => [p.kind, p.amountCents, p.dueOn]),
      [['TOTAL', 1458500, null]]
    );
    assert.deepEqual(
      draft.tasks.map((t) => [t.title, t.dueOn, t.travelerVisible]),
      [['Digitale Einreisekarte Thailand ausfüllen', '2027-02-01', true]]
    );
  });

  it('Reisebüro aus der Buchungsstelle', () => {
    const advisor = draft.contacts.find((contact) => contact.kind === 'ADVISOR');
    assert.deepEqual(
      [advisor?.name, advisor?.phone, advisor?.email, advisor?.address],
      ['Reisebüro Muster GmbH', '012345678900', 'info@reisebuero.example', 'Testweg 1, 12345 Teststadt']
    );
  });
});
