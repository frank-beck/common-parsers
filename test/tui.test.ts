import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { PdfPage } from '../src/core/pdf-text.js';
import { tuiCruisesParser } from '../src/parsers/tui-cruises.js';
import { tuiDeutschlandParser } from '../src/parsers/tui-deutschland.js';
import { parsers } from '../src/parsers/index.js';
import { selectParser as select } from '../src/core/select.js';
import { musterPages } from './muster.js';

const selectParser = (input: PdfPage[]) => select(parsers, input);

const pages = (...texts: string[]): PdfPage[] => texts.map((text, index) => ({ pageNumber: index + 1, text }));

const CRUISE_PAGE_ONE = [
  'TUI Cruises GmbH • Heidenkampsweg 58 • 20097 Hamburg',
  'Mein Schiff 9 Ihr Schiff:',
  'Ihre Reise: 7 Nächte - Testroute Mittelamerika - ab/bis Belize City',
  'Ihr Reisedatum: 04.05. - 12.05.2028',
  'Frau',
  'ERIKA MUSTERFRAU',
  'TESTWEG 1',
  '12345 TESTSTADT',
  'Reisebestätigung / Rechnung',
  'Vorgang-Nr.: 9999999/1',
  'Datum: 01.03.2027',
  'Bitte wenden Sie sich für Fragen und',
  'Änderungswünsche an:',
  'Musterreisen GmbH',
  '.',
  'Tel: +49 700 1234567',
  'Teilnehmer Preis pro Person Alter/Geburtsdatum',
  '1.000,00 € 1. Frau MUSTERFRAU/ERIKA 01.01.1970',
  '1.000,00 € 2. Herr MUSTERMANN/MAX 02.02.1972',
  '1-2 04.05.2028 -',
  '11.05.2028',
  'Mein Schiff 9',
  'Testkabine Balkon (2er Belegung)',
  'Deck 7 - Achat - Kabine 7001',
  'Änderungen der Termine, Route, Tendern, Liegezeiten',
  'vorbehalten',
  '04.05.2028 Belize City - 05.05.2028 Seetag - 06.05.2028 Testhafen',
  'Nord (Testland) - 07.05.2028 Seetag - 08.05.2028 Testbucht -',
  '09.05.2028 Seetag - 10.05.2028 Testinsel - 11.05.2028 Belize City',
  'Premium Alles Inklusive',
  'PRO-Tarif',
  'Deutsche, Schweizer und österreichische Staatsangehörige',
  'benötigen einen Reisepass, der noch min. 6 Monate nach',
  'Reiseende gültig ist.'
].join('\n');

const CRUISE_MANIFEST_PAGE = [
  'SCHIFFSMANIFEST',
  'Bitte übermitteln Sie das sogenannte Schiffsmanifest unbedingt bis spätestens 6 Wochen vor Abreise',
  'online an TUI Cruises.',
  'Die Bekanntgabe Ihrer Flugzeiten erfolgt frühestens ab 4 Monate vor Abreise in Ihrem Portal.',
  'REISEUNTERLAGEN',
  'Ihre Reiseunterlagen erhalten Sie frühestens 14 Tage vor Ihrer Abreise per E-Mail.'
].join('\n');

describe('TUI-Cruises-Beleg', () => {
  const parse = (paymentBlock: string) =>
    tuiCruisesParser.parse(pages(CRUISE_PAGE_ONE, paymentBlock, CRUISE_MANIFEST_PAGE));

  const cardWording = [
    'Gesamtpreis 2.000,00 €',
    '500,00 € Anzahlung (Abbuchung von der Kreditkarte zum 08.03.2027)',
    '1.500,00 € Restzahlung (Abbuchung von der Kreditkarte zum 04.03.2028)'
  ].join('\n');

  const transferWording = [
    'Gesamtpreis 2.000,00 €',
    '500,00 € Anzahlung (überweisen Sie bitte bis zum 08.03.2027)',
    '1.500,00 € Restzahlung (überweisen Sie bitte bis zum 04.03.2028)'
  ].join('\n');

  it('erkennt den Beleg sicher', () => {
    const match = selectParser(pages(CRUISE_PAGE_ONE, cardWording, CRUISE_MANIFEST_PAGE));
    assert.equal(match?.parser.id, 'tui-cruises');
    assert.ok((match?.confidence ?? 0) >= 0.8);
  });

  it('liest Kopfdaten, Zeitraum und Teilnehmer', () => {
    const { draft, warnings } = parse(cardWording);
    assert.deepEqual(warnings, []);
    assert.equal(draft.reference, '9999999/1');
    assert.equal(draft.bookingDate, '2027-03-01');
    assert.equal(draft.startsOn, '2028-05-04');
    assert.equal(draft.endsOn, '2028-05-12');
    assert.equal(draft.destinationCountry, 'Mittelamerika');
    assert.equal(draft.destinationTimeZone, 'America/Panama');
    assert.equal(draft.customer.displayName, 'Erika Musterfrau');
    assert.deepEqual(
      draft.participants.map((participant) => participant.displayName),
      ['Erika Musterfrau', 'Max Mustermann']
    );
  });

  it('baut den Routenplan vom Einschiffungs- bis zum Rückkehrhafen', () => {
    const { draft } = parse(cardWording);
    const stops = draft.items.filter((item) => item.kind === 'ACTIVITY' || item.kind === 'NOTE');
    assert.deepEqual(
      stops.map((stop) => `${stop.date} ${stop.title}`),
      [
        '2028-05-04 Belize City',
        '2028-05-05 Seetag',
        '2028-05-06 Testhafen Nord (Testland)',
        '2028-05-07 Seetag',
        '2028-05-08 Testbucht',
        '2028-05-09 Seetag',
        '2028-05-10 Testinsel',
        '2028-05-11 Belize City'
      ]
    );
    const cabin = draft.items.find((item) => item.kind === 'HOTEL');
    assert.equal(cabin?.title, 'Mein Schiff 9');
    assert.equal(cabin?.description, 'Deck 7 - Achat - Kabine 7001');
  });

  it('rechnet die relativen Fristen des Belegs aus', () => {
    const { draft } = parse(cardWording);
    const byTitle = new Map(draft.tasks.map((task) => [task.title, task]));
    assert.equal(byTitle.get('Schiffsmanifest übermitteln')?.dueOn, '2028-03-23');
    assert.equal(byTitle.get('Schiffsmanifest übermitteln')?.required, true);
    assert.equal(byTitle.get('Reiseunterlagen treffen ein')?.dueOn, '2028-04-20');
    assert.equal(byTitle.get('Flugzeiten prüfen')?.dueOn, '2028-01-04');
    assert.equal(byTitle.get('Reisepass auf Gültigkeit prüfen')?.required, true);
  });

  it('liest beide Zahlungsformulierungen desselben Veranstalters', () => {
    for (const block of [cardWording, transferWording]) {
      const { draft } = parse(block);
      const deposit = draft.payments.find((payment) => payment.kind === 'DEPOSIT');
      const balance = draft.payments.find((payment) => payment.kind === 'BALANCE');
      assert.equal(deposit?.dueOn, '2027-03-08', `Anzahlung fehlt bei: ${block.split('\n')[1]}`);
      assert.equal(deposit?.amountCents, 50_000);
      assert.equal(balance?.dueOn, '2028-03-04');
      assert.equal(balance?.amountCents, 150_000);
    }
  });

  it('hält Zahlungsfristen aus der Kundensicht heraus', () => {
    const { draft } = parse(cardWording);
    const payments = draft.tasks.filter((task) => task.title.endsWith('fällig'));
    assert.equal(payments.length, 2);
    assert.ok(payments.every((task) => task.travelerVisible === false));
  });

  it('übernimmt nur die gebuchte Tarifstufe', () => {
    const { draft } = parse(cardWording);
    assert.deepEqual(draft.inclusions, ['Premium Alles Inklusive', 'PRO-Tarif']);
  });
});

const PACKAGE_PAGE = [
  'Hallo Frau Erika Musterfrau,',
  'danke, dass Sie mit TUI Deutschland GmbH verreisen möchten!',
  'Musterreisen GmbH',
  'Teilnehmerpreise',
  '1 Frau Erika Musterfrau (01.01.1970) 900,00 €',
  '2 Herr Max Mustermann (02.02.1972) 900,00 €',
  'Gesamtpreis 1.800,00 €',
  'Zahlungsinformationen #',
  'Zahlungsart: Kreditkarte (Mastercard) Gesamtpreis: 1.800,00 €',
  'Karten-Nr.: 111111******2222 Anzahlung: 450,00 € Fälligkeit: 05.04.2027',
  'Gültig bis: 10/29 Restzahlung: 1.350,00 € Fälligkeit: 01.06.2028',
  'Wichtig: Bitte beachten Sie, dass Ihre Zahlung nur bei einem ausreichenden Kreditkartenlimit erfolgreich durchgeführt werden kann!',
  'Prüfen Sie spätestens eine Woche vor Fälligkeit Ihrer Zahlung Ihr Tages-/Wochen-/Monats-Limit und die Gültigkeit Ihrer Kreditkarte.',
  'Buchung im Detail #',
  'Buchung: 12345678 | Vertrags-/Versicherungsbeginn: 04.07.2028 | Agentur ID: 000000 | Datum: 05.04.2027 10:00 Uhr',
  '04.07.2028 Hinflug',
  'Voraussichtliche Flugzeit: 06:15 – 10:40 Uhr (4h 25m)',
  'Stuttgart (STR) > Teneriffa Süd (TFS)',
  'TUIfly X99001 – Economy Class',
  '1–2 im Paket',
  '04.07.2028 Bustransfer inkl. 1–2 im Paket',
  '04.07.2028 –',
  '11.07.2028',
  'Paket (Unterkunft)',
  'Testhotel Sonnenblick (TFS99999)',
  'Costa Adeje',
  'bestätigt',
  'Zimmertyp: DZX1, Double Standard (Belegung: 2 Personen)',
  'Zimmerausstattung: Dusche, WC, Balkon',
  'Ihre Verpflegung: Halbpension',
  'Teneriffa / Costa Adeje / Testhotel: In diesem Hotel gilt ein Mindestalter von 18 Jahren.',
  '11.07.2028 Rückflug',
  'Voraussichtliche Flugzeit: 23:10 – 04:30 Uhr (5h 20m)',
  'Teneriffa Süd (TFS) > Stuttgart (STR)',
  'TUIfly X99002 – Economy Class',
  '1–2 im Paket',
  '04.07.2028 Entgelt Flex Tarif bis 2500 Euro (CL1X5401)',
  'Flexibilität, Ihre Reise bis einschließlich 15 Tage vor Reisebeginn flexibel umbuchen oder stornieren zu können.',
  'Der Web Check-in ist in Kombination mit einer kostenpflichtigen Sitzplatzreservierung ab 14 Tage vor Abflug möglich.',
  'TUI Deutschland GmbH · Karl-Wiechert-Allee 23 · DE - 30625 Hannover',
  'Telefonnummer: +49 511 87 9898-98 E-Mail-Adresse: fragenvorderreise@tui.de'
].join('\n');

describe('TUI-Deutschland-Beleg', () => {
  it('wählt den richtigen Parser', () => {
    const match = selectParser(pages(PACKAGE_PAGE));
    assert.equal(match?.parser.id, 'tui-deutschland');
  });

  it('liest Flüge mit Uhrzeit und erkennt den Nachtflug', () => {
    const { draft, warnings } = tuiDeutschlandParser.parse(pages(PACKAGE_PAGE));
    assert.deepEqual(warnings, []);
    const flights = draft.items.filter((item) => item.kind === 'FLIGHT');
    assert.equal(flights.length, 2);
    assert.equal(flights[0]?.startTime, '06:15');
    assert.equal(flights[0]?.endDate, '2028-07-04');
    assert.equal(flights[0]?.confirmationCode, 'X99001');
    // Landung nach Mitternacht gehört auf den Folgetag.
    assert.equal(flights[1]?.date, '2028-07-11');
    assert.equal(flights[1]?.endDate, '2028-07-12');
  });

  it('liest Hotel, Verpflegung und Zusatzleistungen', () => {
    const { draft } = tuiDeutschlandParser.parse(pages(PACKAGE_PAGE));
    const hotel = draft.items.find((item) => item.kind === 'HOTEL');
    assert.equal(hotel?.title, 'Testhotel Sonnenblick');
    assert.equal(hotel?.confirmationCode, 'TFS99999');
    assert.equal(hotel?.location, 'Costa Adeje');
    assert.match(hotel?.subtitle ?? '', /Halbpension/);
    assert.equal(draft.items.filter((item) => item.kind === 'TRANSFER').length, 1);
    assert.equal(draft.destination, 'Teneriffa');
    assert.equal(draft.destinationTimeZone, 'Atlantic/Canary');
  });

  it('rechnet Zahlungs- und Handlungsfristen aus', () => {
    const { draft } = tuiDeutschlandParser.parse(pages(PACKAGE_PAGE));
    const byTitle = new Map(draft.tasks.map((task) => [task.title, task]));
    assert.equal(byTitle.get('Anzahlung fällig')?.dueOn, '2027-04-05');
    assert.equal(byTitle.get('Restzahlung fällig')?.dueOn, '2028-06-01');
    assert.equal(byTitle.get('Kreditkartenlimit prüfen')?.dueOn, '2028-05-25');
    assert.equal(byTitle.get('Kreditkartenlimit prüfen')?.travelerVisible, false);
    assert.equal(byTitle.get('Letzter Tag für kostenfreie Umbuchung oder Storno')?.dueOn, '2028-06-19');
    assert.equal(byTitle.get('Web-Check-in öffnet')?.dueOn, '2028-06-20');
  });
});

describe('Parserauswahl', () => {
  it('lehnt fremde Belege ab, statt zu raten', () => {
    assert.equal(selectParser(pages('Rechnung der Stadtwerke Musterstadt über 42,00 €')), null);
  });

  it('verwechselt die beiden TUI-Familien nicht', () => {
    const cruiseText = `${CRUISE_PAGE_ONE}\nTUI Deutschland GmbH als Vermittler`;
    assert.equal(selectParser(pages(cruiseText))?.parser.id, 'tui-cruises');
    assert.equal(tuiDeutschlandParser.detect(pages(cruiseText)), 0);
  });
});

describe('TUI-Deutschland-Rundreise (Muster test/fixtures/tui-rbe-muster.txt)', () => {
  const { draft, warnings } = tuiDeutschlandParser.parse(musterPages('tui-rbe-muster.txt'));

  it('Hinflug über Nacht: Datumsspanne vor „Hinflug“ gilt', () => {
    const outbound = draft.items.find((item) => item.title.startsWith('Hinflug'));
    assert.deepEqual(
      [outbound?.date, outbound?.startTime, outbound?.endDate, outbound?.endTime],
      ['2027-02-16', '21:15', '2027-02-17', '14:20']
    );
    assert.deepEqual(warnings, []);
  });

  it('liest Inlandsflug, alle Hotels und Minibus-Transfers', () => {
    assert.deepEqual(
      draft.items.filter((item) => item.kind === 'FLIGHT').map((item) => [item.date, item.confirmationCode]),
      [
        ['2027-02-16', 'DE2574'],
        ['2027-02-21', 'PG275'],
        ['2027-03-04', 'DE2369']
      ]
    );
    assert.deepEqual(
      draft.items.filter((item) => item.kind === 'HOTEL').map((item) => [item.title, item.date, item.endDate, item.location]),
      [
        ['Tower Club at Lebua', '2027-02-17', '2027-02-21', 'Bangkok'],
        ['Katathani Phuket Beach Resort', '2027-02-21', '2027-02-26', 'Kata Noi Beach'],
        ['ROBINSON KHAO LAK', '2027-02-26', '2027-03-04', 'Khao Lak']
      ]
    );
    assert.deepEqual(
      draft.items.filter((item) => item.kind === 'TRANSFER').map((item) => [item.date, item.title]),
      [
        ['2027-02-17', 'Bustransfer'],
        ['2027-02-21', 'Minibus-Transfer'],
        ['2027-02-26', 'Minibus-Transfer'],
        ['2027-03-04', 'Bustransfer']
      ]
    );
    assert.equal(draft.startsOn, '2027-02-16');
    assert.equal(draft.endsOn, '2027-03-04');
  });

  it('Rundreise: Land als Ziel, Stationen als Titel', () => {
    assert.equal(draft.title, 'Thailand: Bangkok, Kata Noi Beach, Khao Lak');
    assert.equal(draft.destinationTimeZone, 'Asia/Bangkok');
  });

  it('Kinder nach Zeile „Kind“ und nach Alter bei Reisebeginn', () => {
    assert.deepEqual(
      draft.participants.map((p) => [p.displayName, p.kind]),
      [
        ['Max Mustermann', 'PRIMARY'],
        ['Erika Musterfrau', 'COMPANION'],
        ['Lena Beispiel', 'CHILD'],
        ['Paul Mustermann', 'CHILD'],
        ['Mia Mustermann', 'CHILD']
      ]
    );
  });

  it('Kundschaft und Reisebüro aus „Ihre Daten“', () => {
    assert.deepEqual(draft.customer, {
      displayName: 'Max Mustermann',
      email: 'kontakt1@example.com',
      phone: '+49 (0)700 1234567',
      address: 'Testweg 2, 12345 Teststadt'
    });
    const advisor = draft.contacts.find((contact) => contact.kind === 'ADVISOR');
    assert.deepEqual(
      [advisor?.name, advisor?.phone, advisor?.email, advisor?.address],
      ['Reisebüro Muster GmbH', '+49 (0)700 7654321', 'kontakt2@example.com', 'Testweg 3, 12345 Teststadt']
    );
  });

  it('Optionsfrist und Zahlungen als interne Aufgaben', () => {
    assert.deepEqual(
      draft.tasks.map((task) => [task.title, task.dueOn, task.travelerVisible]),
      [
        ['Reservierung wird automatisch gebucht', '2026-09-28', false],
        ['Anzahlung fällig', '2026-09-28', false],
        ['Restzahlung fällig', '2027-01-19', false]
      ]
    );
  });
});
