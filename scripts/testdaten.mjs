// Erkennbare Testdaten: Personen, Anschriften, Telefon, Geburtsdaten in test/ nur aus diesem Pool.
// Wer „Max Mustermann, Musterstraße 1, 12345 Musterstadt, +49 000 1111111“ liest, sieht sofort: erfunden.
// Ein echter Name fällt auf, weil er nicht im Pool steht. Prüft `npm run datenschutz` und die Commit-Sperre.

export const POOL = {
  vornamen: ['Max', 'Erika', 'Moritz', 'Lisa', 'Paul', 'Mia', 'Tom', 'Lena', 'Ben', 'Anna', 'Peter'],
  nachnamen: ['Mustermann', 'Musterfrau', 'Muster', 'Beispiel'],
  strasse: 'Musterstraße', // mit Hausnummer: „Musterstraße 1“
  ort: '12345 Musterstadt',
  orte: ['Musterstadt', 'Teststadt'],
  telefon: '+49 000 1111111', // Ziffern nur 0 und 1
  email: '@example.com', // auch .org, .net, .test, .invalid
  iban: 'DE00 1234 5678 9012 3456 78', // Prüfziffer falsch
  geburtsdatum: '01.01.', // + Jahr: Alter bleibt
  reisebuero: 'Reisebüro Muster GmbH',
  nummer: '9' // Buchungs-, Kunden-, Ticketnummern: Neunen, Länge bleibt
};

/** Platzhalter, die Veranstalter selbst einsetzen („Tba Tbab“ bei DERTOUR, Name folgt). */
const PLATZHALTER = /^tba[a-z]?$/i;
/** Großgeschrieben mit Schrägstrich, aber keine Person. */
const KEINE_PERSON = new Set(['swift', 'bic']);

/** Anschriften und Hotlines von Veranstaltern: öffentlich, darf ein Parser kennen. */
export const ERLAUBTE_ORTE = ['30625 Hannover', '20097 Hamburg', '51149 Köln', '51170 Köln'];
export const ERLAUBTE_TELEFONE = ['+49 511 87 9898-98'];

/** Prüfen nur Gegenbeispiele: Tests der Sperre selbst brauchen echt aussehende Namen. */
export const NUR_GEGENBEISPIELE = new Set(['test/anonym.test.ts', 'test/datenschutz.test.ts', 'test/testdaten.test.ts']);

const DATUM = '\\d{1,2}\\.\\d{1,2}\\.\\d{4}';
const WORT = '[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+';
// „Herr Max Mustermann (01.01.1970)“, „Frau\nERIKA MUSTERFRAU“, „Kind Mia Muster“
const ANREDE = new RegExp(`\\b(?:Herrn?|Frau|Kind)\\s+(${WORT}(?:[ \\t]+${WORT}){0,3})(?:\\s*\\((${DATUM})\\))?`, 'g');
// „MUSTERFRAU/ERIKA 01.01.1970“
const SCHRAEG = new RegExp(`\\b(${WORT})\\/(${WORT}(?:[ \\t]+${WORT})?)(?:\\s+(${DATUM}))?`, 'g');
// „15/01.01.2012“ (Alter/Geburtsdatum)
const ALTER_DATUM = new RegExp(`\\b\\d{1,2}\\/(${DATUM})`, 'g');
const PLZ_ORT = /(?<![\d.,/])(\d{5})[ \t]+(\p{Lu}[\p{L}-]+)/gu;
// nicht in IBAN („DE00 1234 …“) oder Beträgen
const TELEFON = /(?:\(?\+\d{2}\)?|(?<![\p{L}\d.,])0)[\d ()/–-]{6,22}\d\b/gu;

const namenspool = new Set([...POOL.vornamen, ...POOL.nachnamen].map((name) => name.toLowerCase()));
const istPoolname = (wort) => namenspool.has(wort.toLowerCase()) || PLATZHALTER.test(wort);
const istPooldatum = (datum) => !datum || datum.startsWith(POOL.geburtsdatum);
// Nach Länder- und Ortsvorwahl-Null nur noch 0 und 1: „+49 000 1111111“, „000000“
const istPooltelefon = (nummer) => /^(?:49)?[01]+$/.test(nummer.replace(/\D/g, ''));

/**
 * @param {string} text
 * @returns {{ index: number, problem: string }[]}  index = Zeichenposition im Text
 */
export function pruefeTestdaten(text) {
  const funde = [];
  const melde = (index, problem) => funde.push({ index, problem });

  for (const treffer of text.matchAll(ANREDE)) {
    const fremd = treffer[1].split(/\s+/).filter((wort) => !istPoolname(wort));
    if (fremd.length) melde(treffer.index, `Name „${fremd.join(' ')}“ nicht aus dem Pool — erfunden: ${POOL.vornamen[0]} ${POOL.nachnamen[0]}`);
    if (!istPooldatum(treffer[2])) melde(treffer.index, `Geburtsdatum ${treffer[2]} — erfunden: ${POOL.geburtsdatum}${treffer[2].slice(-4)}`);
  }
  for (const treffer of text.matchAll(SCHRAEG)) {
    const woerter = [treffer[1], ...treffer[2].split(/\s+/)];
    // Nur Personen: beide Seiten großgeschrieben, wie auf Tickets und Teilnehmerlisten
    if (!woerter.every((wort) => wort === wort.toUpperCase()) || woerter.some((wort) => KEINE_PERSON.has(wort.toLowerCase()))) continue;
    const fremd = woerter.filter((wort) => !istPoolname(wort));
    if (fremd.length) melde(treffer.index, `Name „${fremd.join(' ')}“ nicht aus dem Pool — erfunden: ${POOL.nachnamen[0].toUpperCase()}/${POOL.vornamen[0].toUpperCase()}`);
    if (!istPooldatum(treffer[3])) melde(treffer.index, `Geburtsdatum ${treffer[3]} — erfunden: ${POOL.geburtsdatum}${treffer[3].slice(-4)}`);
  }
  for (const treffer of text.matchAll(ALTER_DATUM)) {
    if (!istPooldatum(treffer[1])) melde(treffer.index, `Geburtsdatum ${treffer[1]} — erfunden: ${POOL.geburtsdatum}${treffer[1].slice(-4)}`);
  }
  for (const treffer of text.matchAll(PLZ_ORT)) {
    const ort = `${treffer[1]} ${treffer[2]}`;
    const pool = treffer[1] === '12345' && POOL.orte.some((name) => name.toLowerCase() === treffer[2].toLowerCase());
    if (!pool && !ERLAUBTE_ORTE.includes(ort)) melde(treffer.index, `Anschrift „${ort}“ — erfunden: ${POOL.ort}; Veranstalter: ERLAUBTE_ORTE in scripts/testdaten.mjs`);
  }
  for (const treffer of text.matchAll(TELEFON)) {
    const nummer = treffer[0].trim();
    if (nummer.replace(/\D/g, '').length < 6 || istPooltelefon(nummer) || ERLAUBTE_TELEFONE.includes(nummer)) continue;
    melde(treffer.index, `Telefon „${nummer}“ — erfunden: ${POOL.telefon}; Veranstalter: ERLAUBTE_TELEFONE in scripts/testdaten.mjs`);
  }
  return funde;
}
