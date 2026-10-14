// Ersetzungen für privat/ersetzen.txt, automatisch: `npm run lesen -- privat/beleg.pdf --anonym`.
//
// Quellen: was der Parser erkennt (Namen, Geburtsdaten, Reisebüro, Kundschaft)
// und feste Muster (Teilnehmerzeilen, E-Mail, IBAN, Telefon, Nummern ab 6 Ziffern,
// Kunden-/Rechnungs-/Steuernummern, Anschriftblöcke).
// Findet nicht: Namen, die der Parser nicht kennt und die keinem Muster folgen —
// darum das Muster danach trotzdem lesen (docs/neuer-parser.md, Schritt 3).
import { ERLAUBTE_DOMAINS, alsWort } from './datenschutz.mjs';

const VORNAMEN = ['Max', 'Erika', 'Lena', 'Paul', 'Mia', 'Tom', 'Anna', 'Ben', 'Lea', 'Jan'];
const NACHNAMEN = ['Mustermann', 'Musterfrau', 'Beispiel', 'Muster'];
// Kein Name: Anrede, Platzhalter („Tba“ bei DERTOUR), Ersatznamen der Parser
const KEIN_NAME = /^(?:herr|herrn|frau|kind|tba|reisende\/r|dr\.?|prof\.?)$/i;

const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g;
// auch „+49 (0)7000 …“, „(+49) (0)30 – …“
const TELEFON = /(?:\(?\+\d{2}\)?|\b0)[\d ()/–-]{6,22}\d\b/g;
const NUMMER = /(?<![\p{L}\p{N}])([A-Z]{0,4})(\d{6,20})(?![\p{L}\p{N}])/gu;
// „12345 Teststadt“, „D - 12345 Teststadt“; „Lindenweg 5“, „Am Tal 16/1“
const ORT = /^(?:[A-Z]{1,2}\s?-\s?)?\d{4,5}\s+\p{Lu}[\p{L} .-]{1,40}$/u;
const STRASSE = /^\p{Lu}[\p{L} .-]{2,40}\s\d{1,4}(?:\/\d{1,3})?\s?[a-z]?$/u;
// „5 Kind Mia Muster (01.06.2016)“ — auch wenn der Parser die Zeile nicht kennt
const TEILNEHMER = /^\s*\d{1,2}\s+(?:Herrn?|Frau|Kind)\s+([^\n(]{3,60}?)\s*\((\d{1,2}\.\d{1,2}\.\d{4})\)/gm;
const BELEGNUMMER = /(?:Kunden|Rechnungs|Steuer|Vorgangs|Buchungs|Ticket|Reservierungs)[\p{L}-]*(?:nr\.?|nummer)\s*:?\s*([A-Z0-9][A-Z0-9/.-]{3,})/giu;

const isoAlsDeutsch = (iso) => iso.split('-').reverse().join('.');

/**
 * @param {import('../src/core/draft.js').TripImportDraft} draft
 * @param {string} text  ganzer Belegtext
 * @returns {{ echt: string, erfunden: string, art: string }[]}
 */
export function ersetzungen(draft, text) {
  const paare = new Map();
  const neu = (echt, erfunden, art) => {
    const key = echt.trim().toLowerCase();
    if (key.length >= 3 && !paare.has(key)) paare.set(key, { echt: echt.trim(), erfunden, art });
  };

  let vorname = 0;
  let nachname = 0;
  const zeilenTeilnehmer = [...text.matchAll(TEILNEHMER)];
  const namen = [draft.customer.displayName, ...draft.participants.map((p) => p.displayName), ...zeilenTeilnehmer.map((m) => m[1])];
  for (const name of namen.filter(Boolean)) {
    const woerter = name.split(/\s+/).filter((wort) => wort.length >= 3 && !KEIN_NAME.test(wort) && !/\d/.test(wort));
    woerter.forEach((wort, index) => {
      if (paare.has(wort.toLowerCase())) return;
      const letztes = woerter.length > 1 && index === woerter.length - 1;
      neu(wort, letztes ? NACHNAMEN[nachname++ % NACHNAMEN.length] : VORNAMEN[vorname++ % VORNAMEN.length], 'Name');
    });
  }
  for (const { birthDate } of draft.participants) {
    if (birthDate) neu(isoAlsDeutsch(birthDate), `01.01.${birthDate.slice(0, 4)}`, 'Geburtsdatum');
  }
  for (const [, , datum] of zeilenTeilnehmer) neu(datum, `01.01.${datum.slice(-4)}`, 'Geburtsdatum');

  for (const contact of draft.contacts.filter((c) => c.kind === 'ADVISOR')) {
    if (contact.name) neu(contact.name, 'Reisebüro Muster GmbH', 'Reisebüro');
  }
  const kunde = draft.customer;
  if (kunde.address) neu(kunde.address, 'Testweg 1, 12345 Teststadt', 'Anschrift');

  let mail = 0;
  for (const [adresse, domain] of text.matchAll(EMAIL)) {
    if (!ERLAUBTE_DOMAINS.includes(domain.toLowerCase())) neu(adresse, `kontakt${++mail}@example.com`, 'E-Mail');
  }
  for (const [iban] of text.matchAll(IBAN)) neu(iban, 'DE00 1234 5678 9012 3456 78', 'IBAN');
  // Vor den Nummern: sonst bleiben von „0711 1234567“ nur Bruchstücke
  for (const [telefon] of text.matchAll(TELEFON)) {
    // Ersatz ohne 6 Ziffern am Stück, sonst ersetzt NUMMER ihn noch einmal
    if (telefon.replace(/\D/g, '').length >= 8) neu(telefon, '+49 700 123 4567', 'Telefon');
  }
  for (const [, wert] of text.matchAll(BELEGNUMMER)) {
    if (/\d/.test(wert)) neu(wert, wert.replace(/\d/g, '9'), 'Nummer');
  }
  let nummer = 0;
  for (const [ganz, prefix, ziffern] of text.matchAll(NUMMER)) {
    const ersatz = String(++nummer).padStart(ziffern.length, '9');
    neu(ganz, `${prefix}${ersatz}`, 'Nummer');
  }

  const zeilen = text.split('\n').map((zeile) => zeile.trim());
  zeilen.forEach((zeile, index) => {
    if (!ORT.test(zeile)) return;
    neu(zeile, '12345 Teststadt', 'Anschrift');
    const davor = zeilen[index - 1] ?? '';
    if (STRASSE.test(davor)) neu(davor, 'Testweg 1', 'Anschrift');
  });

  // Längste zuerst, wie lesen.mjs ersetzt: „0711 1234567“ vor „1234567“
  return [...paare.values()].sort((a, b) => b.echt.length - a.echt.length);
}

/**
 * Jede linke Seite durch die rechte, ganze Wörter, Groß/klein egal; `SCHMIDT` wird `MUSTERFRAU`.
 * @param {string} text
 * @param {[string, string?][]} paare  längste zuerst
 */
export function ersetze(text, paare) {
  let muster = text;
  for (const [echt, erfunden = 'MUSTER'] of paare) {
    muster = muster.replace(new RegExp(alsWort(echt).source, 'giu'), (treffer) =>
      treffer === treffer.toUpperCase() ? erfunden.toUpperCase() : erfunden
    );
  }
  return muster;
}
