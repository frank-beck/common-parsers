import type { DocumentParser, DraftEvidence, DraftItem, DraftParticipant, DraftPayment, DraftTask, ParseResult } from '../core/draft.js';
import { emptyDraft } from '../core/draft.js';
import type { PdfPage } from '../core/pdf-text.js';
import { joinedText } from '../core/pdf-text.js';
import { EXCERPT_MAX, collapse, euroCents, germanDate, guessRegion, isoDate, matchAll, matchFirst, shiftDate } from '../core/text.js';

const DATE = '\\d{1,2}\\.\\d{1,2}\\.\\d{4}';
const SHORT_DATE = '\\d{1,2}\\.\\d{1,2}\\.\\d{2}';
const STATUS = 'Bestätigt';
const AIRLINES: Record<string, string> = {
  A3: 'Aegean Airlines',
  DE: 'Condor',
  EW: 'Eurowings',
  LH: 'Lufthansa',
  PC: 'Pegasus',
  X3: 'TUIfly',
  XQ: 'SunExpress'
};

interface Leg {
  date: string;
  endDate: string | null;
  type: string;
  text: string;
  evidence: DraftEvidence;
}

/** `STUTTGART` → `Stuttgart`, `NEA POTIDEA` → `Nea Potidea`. */
function titleCase(input: string): string {
  return collapse(input).toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** Beträge mal mit Komma (`617,00`), im Lastschriftteil mit Punkt (`155.00`). */
function cents(raw: string | null | undefined): number | null {
  return euroCents(raw?.trim().replace(/^(\d+)\.(\d{2})$/, '$1,$2'));
}

/** `01.01.73` → `1973-01-01`: zweistellige Jahre nach der Reise liegen im Jahrhundert davor. */
function birthDate(raw: string, travelYear: number): string | null {
  const short = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(raw);
  if (!short) return germanDate(raw);
  const year = 2000 + Number(short[3]);
  return isoDate(year > travelYear ? year - 100 : year, Number(short[2]), Number(short[1]));
}

/** `ddmm` aus der Flugtabelle → Datum des passenden Reiseverlaufs, sonst Jahr des Reisebeginns. */
function legDate(day: string, month: string, legs: readonly Leg[], startsOn: string | null): string | null {
  const suffix = `-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const known = legs.find((leg) => leg.date.endsWith(suffix))?.date;
  if (known) return known;
  const year = Number(startsOn?.slice(0, 4));
  return year ? isoDate(year, Number(month), Number(day)) : null;
}

/** Block „Reiseverlauf“: `08.10.2026 . . Hinflug : STUTTGART - THESSALONIKI`, `… - 11.10.2026 HOTEL : Name, Ort`. */
function parseLegs(pages: readonly PdfPage[]): Leg[] {
  return matchAll(pages, new RegExp(`^(${DATE})\\s+(?:-\\s+(${DATE})|\\.\\s*\\.)\\s+([^:\\n]+?)\\s*:\\s*([^\\n]+)$`, 'gm')).map((row) => ({
    date: germanDate(row.group(0)) ?? '',
    endDate: germanDate(row.group(1)),
    type: row.group(2),
    text: row.group(3),
    evidence: row.evidence
  }));
}

function parseItems(pages: readonly PdfPage[], legs: readonly Leg[], warnings: string[]): DraftItem[] {
  const base = { description: null, startTime: null, endDate: null, endTime: null, location: null, confirmationCode: null, statusLabel: STATUS };
  // „STR SKG 08.10 05:50 09:00 EW2680 1P ECONOMY“
  const rows = matchAll(
    pages,
    /^([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,2})\.(\d{1,2})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+([A-Z0-9]{2}\d{1,4})\s+(?:(\d+)P\s+)?([A-Z ]+?)\s*$/gm
  );
  // „3 Tage Istion Club ohne Transfer Nea Potidea“ / „vom 08.10.26 bis 11.10.26, 1 Erwachsener“ / „1 Doppelzimmer=Einzelzimmer, Halbpension EUR 617,00“
  const stays = matchAll(
    pages,
    new RegExp(`vom\\s+(${SHORT_DATE})\\s+bis\\s+(${SHORT_DATE}),\\s*([^\\n]+)\\n\\s*(\\d+)\\s+([^,\\n]+),\\s*([^\\n]+?)(?:\\s+EUR\\s+[\\d.,]+)?$`, 'gm')
  );
  const startsOn = legs[0]?.date ?? null;
  const items: DraftItem[] = [];
  let flightIndex = 0;

  for (const leg of legs) {
    if (/flug/i.test(leg.type)) {
      const [fromName = '', toName = ''] = leg.text.split(/\s+-\s+/).map(titleCase);
      const row = rows[flightIndex];
      flightIndex += 1;
      if (!row) {
        items.push({ ...base, kind: 'FLIGHT', title: `${leg.type} ${fromName} → ${toName}`, subtitle: null, date: leg.date, location: toName || null, evidence: leg.evidence });
        warnings.push(`${leg.type} am ${leg.date}: keine Flugzeiten gefunden.`);
        continue;
      }
      const [from = '', to = '', day = '', month = '', departure = '', arrival = '', flightNumber = '', pieces = '', cabin = ''] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) =>
        row.group(index)
      );
      const date = legDate(day, month, legs, startsOn) ?? leg.date;
      const airline = AIRLINES[flightNumber.slice(0, 2)] ?? null;
      items.push({
        ...base,
        kind: 'FLIGHT',
        title: `${leg.type} ${fromName || from} → ${toName || to}`,
        subtitle: [flightNumber, airline, titleCase(cabin)].filter(Boolean).join(' · '),
        description: pieces ? `Freigepäck je Person: ${pieces} Gepäckstück${pieces === '1' ? '' : 'e'}` : null,
        date,
        startTime: departure,
        // Ankunft vor Abflug: Nachtflug, landet am Folgetag
        endDate: arrival < departure ? shiftDate(date, 1, 'day') : date,
        endTime: arrival,
        location: `${toName || to} (${to})`,
        confirmationCode: flightNumber,
        evidence: { page: row.evidence.page, excerpt: `${leg.evidence.excerpt} · ${row.evidence.excerpt}`.slice(0, EXCERPT_MAX) }
      });
      continue;
    }

    if (/hotel/i.test(leg.type)) {
      const comma = leg.text.lastIndexOf(',');
      const rawName = comma > 0 ? leg.text.slice(0, comma) : leg.text;
      const transfer = /\s+(ohne|mit|inkl\.?)\s+Transfer$/i.exec(rawName);
      const stay = stays.find((match) => germanDate(match.group(0)) === leg.date);
      const room = stay?.group(4);
      const board = stay?.group(5);
      items.push({
        ...base,
        kind: 'HOTEL',
        title: collapse(transfer ? rawName.slice(0, transfer.index) : rawName),
        subtitle: [room, board].filter(Boolean).join(' · ') || null,
        description: [stay && `${stay.group(3)} ${room}, ${stay.group(2)}`, transfer && `${titleCase(transfer[1] ?? '')} Transfer`].filter(Boolean).join(' · ') || null,
        date: leg.date,
        endDate: leg.endDate,
        location: comma > 0 ? collapse(leg.text.slice(comma + 1)) : null,
        evidence: leg.evidence
      });
      continue;
    }

    const kind = /transfer/i.test(leg.type) ? 'TRANSFER' : /bahn|zug|rail/i.test(leg.type) ? 'TRAIN' : null;
    if (kind) items.push({ ...base, kind, title: collapse(`${leg.type}: ${leg.text}`), subtitle: null, date: leg.date, endDate: leg.endDate, evidence: leg.evidence });
    else warnings.push(`Reiseverlauf „${leg.type}: ${leg.text}“ nicht erkannt — bitte von Hand übernehmen.`);
  }
  return items;
}

function parseParticipants(pages: readonly PdfPage[], startsOn: string | null, warnings: string[]): DraftParticipant[] {
  const block = matchFirst(pages, /Reiseteilnehmer\s+Alter\s*\n([\s\S]*?)\n\s*Reiseverlauf/)?.value ?? '';
  const travelYear = Number(startsOn?.slice(0, 4)) || new Date().getUTCFullYear();
  const adultBornBy = shiftDate(startsOn, -18 * 12, 'month');
  const participants: DraftParticipant[] = [];
  for (const line of block.split('\n').map(collapse).filter(Boolean)) {
    // „FRAU Erika Lisa Mustermann 01.01.73“ — Vornamen vor Nachname, Geburtsdatum mit zweistelligem Jahr
    const row = /^(?:\d+\.?\s+)?([A-ZÄÖÜ]{3,6})\s+(.+?)\s+(\d{1,2}\.\d{1,2}\.\d{2,4})$/.exec(line);
    if (!row) {
      warnings.push(`Reiseteilnehmer „${line}“ nicht erkannt.`);
      continue;
    }
    const birth = birthDate(row[3] ?? '', travelYear);
    // Kind = unter 18 bei Reisebeginn, auch ohne Anrede „KIND“
    const child = row[1] === 'KIND' || Boolean(birth && adultBornBy && birth > adultBornBy);
    participants.push({
      displayName: collapse(row[2]),
      birthDate: birth,
      kind: child ? 'CHILD' : participants.length === 0 ? 'PRIMARY' : 'COMPANION'
    });
  }
  return participants;
}

function parsePayments(pages: readonly PdfPage[], draft: { notes: string[] }, warnings: string[]): DraftPayment[] {
  const payments: DraftPayment[] = [];
  const total = matchFirst(pages, /Gesamt:\s*EUR\s*([\d.,]+)/);
  const totalCents = cents(total?.value);
  if (total) payments.push({ kind: 'TOTAL', label: 'Gesamtpreis', amountCents: totalCents, currency: 'EUR', dueOn: null, evidence: total.evidence });
  else warnings.push('Kein Gesamtpreis erkannt.');

  const paid = matchFirst(pages, /Bereits geleistete Zahlung:\s*([\d.,]+)\s*EUR/);
  const paidCents = cents(paid?.value) ?? 0;
  if (paid) draft.notes.push(`Laut Beleg bereits bezahlt: ${(paidCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} EUR.`);
  // Voll bezahlt: Anzahlung und Restzahlung sind erledigt, keine offenen Posten anlegen.
  if (totalCents !== null && paidCents >= totalCents) return payments;

  const [deposit] = matchAll(pages, new RegExp(`Anzahlung f(?:ae|ä)llig am\\s+(${SHORT_DATE}|${DATE})\\s*\\n\\s*Anzahlungsbetrag:\\s*EUR\\s*([\\d.,]+)`));
  if (deposit && paidCents < (cents(deposit.group(1)) ?? 0)) {
    payments.push({ kind: 'DEPOSIT', label: 'Anzahlung', amountCents: cents(deposit.group(1)), currency: 'EUR', dueOn: germanDate(deposit.group(0)), evidence: deposit.evidence });
  }
  const balance = matchFirst(pages, /Restzahlungsbetrag:\s*EUR\s*([\d.,]+)/);
  if (balance) {
    const due = matchFirst(pages, new RegExp(`Restzahlung f(?:ae|ä)llig am\\s+(${SHORT_DATE}|${DATE})`))?.value;
    payments.push({ kind: 'BALANCE', label: 'Restzahlung', amountCents: cents(balance.value), currency: 'EUR', dueOn: germanDate(due), evidence: balance.evidence });
    if (!due) warnings.push('Restzahlung ohne Fälligkeit im Beleg — Termin eintragen.');
  }
  return payments;
}

function parseTasks(pages: readonly PdfPage[], items: readonly DraftItem[], reference: string | null, payments: readonly DraftPayment[]): DraftTask[] {
  const tasks: DraftTask[] = [];
  const text = joinedText(pages);
  // „*** EUROWINGS-INFO ***“ … „Web-Check-in erforderlich unter:“ / „www.eurowings.com“ / „Ab 72 Stunden vor Abflug“
  const checkIns = matchAll(
    pages,
    /\*+\s*([A-ZÄÖÜ]+)-INFO\s*\*+\s*\n((?:[^\n]*\n){0,10}?)Web-Check-in (erforderlich|gewünscht) unter:\s*\n?\s*(\S+)\s*\n\s*Ab (\d+) Stunden vor Abflug/g
  );
  // Aegean: „Bei der Buchungsnummer muss die erste Ziffer durch den entsprechenden Buchstaben … (1=A, 2=B …)“
  const letterCode = /erste Ziffer durch den\s+entsprechenden Buchstaben/.test(text) && reference && /^[1-9]/.test(reference)
    ? String.fromCharCode(64 + Number(reference[0])) + reference.slice(1)
    : null;
  for (const checkIn of checkIns) {
    const airline = titleCase(checkIn.group(0));
    const hours = Number(checkIn.group(4));
    const fee = /Check-?in am Flughafen kostenpflichtig,?\s*\(?([^)\n]*)\)?/i.exec(checkIn.group(1));
    for (const flight of items.filter((item) => item.kind === 'FLIGHT' && item.subtitle?.includes(airline))) {
      const direction = flight.title.split(' ')[0];
      tasks.push({
        title: `Web-Check-in ${airline}: ${direction}`,
        description: [
          `Online unter ${checkIn.group(3)}, mit Buchungsnummer und Nachnamen.`,
          airline === 'Aegean' && letterCode ? `Buchungsnummer für Aegean: ${letterCode}.` : null,
          fee ? `Check-in am Flughafen kostenpflichtig${fee[1] ? ` (${collapse(fee[1])})` : ''}.` : null
        ]
          .filter(Boolean)
          .join(' '),
        dueOn: shiftDate(flight.date, -Math.floor(hours / 24), 'day'),
        rule: `ab ${hours} Stunden vor Abflug`,
        required: checkIn.group(2) === 'erforderlich',
        travelerVisible: true,
        evidence: checkIn.evidence
      });
    }
  }

  for (const payment of payments) {
    if (payment.kind === 'TOTAL' || !payment.dueOn) continue;
    tasks.push({
      title: `${payment.label} fällig`,
      description: payment.amountCents ? `${(payment.amountCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} ${payment.currency}` : null,
      dueOn: payment.dueOn,
      rule: null,
      required: true,
      travelerVisible: false,
      evidence: payment.evidence
    });
  }
  return tasks;
}

/**
 * Schauinsland-Reisen — Reisebestätigung/Rechnung. Muster: test/fixtures/schauinsland-muster.txt (erfunden).
 * Jede Seite wiederholt Kopf, Reisebüro, Kundenblock und Rechtstext; Inhalt steht unter „Leistungen“.
 * Anleitung und Fallen: docs/neuer-parser.md, Vertrag: docs/vertrag.md
 */
export const schauinslandParser: DocumentParser = {
  id: 'schauinsland',
  version: '1.0.0',
  family: 'Schauinsland-Reisen',
  label: 'Schauinsland-Reisen — Reisebestätigung/Rechnung',
  detect(pages) {
    const text = joinedText(pages);
    if (!/Schauinsland-Reisen GmbH/i.test(text)) return 0;
    return /^Reisebestätigung\/Rechnung$/m.test(text) ? 0.95 : 0.6;
  },
  parse(pages): ParseResult {
    const draft = emptyDraft();
    const warnings: string[] = [];
    const text = joinedText(pages);
    draft.organizer = 'Schauinsland-Reisen GmbH';

    draft.reference =
      matchFirst(pages, /Vorgang:\s*\n\s*BITTE STETS ANGEBEN!\s*\n\s*(\d{5,12})/)?.value ?? matchFirst(pages, /Vorgang:\s*(\d{5,12})/)?.value ?? null;
    if (!draft.reference) warnings.push('Keine Vorgangsnummer erkannt.');

    // Werte stehen nach den Beschriftungen: Buchungsdatum / Leistungsbeginn Druckdatum
    const [head] = matchAll(pages, new RegExp(`Druckdatum:[\\s\\S]{0,200}?(${DATE})\\s+(${DATE})\\s+(${DATE})`));
    draft.bookingDate = germanDate(head?.group(0));
    draft.summary = head ? `Reisebestätigung/Rechnung vom ${head.group(2)}` : 'Reisebestätigung/Rechnung';

    const legs = parseLegs(pages);
    draft.items = parseItems(pages, legs, warnings);
    if (!draft.items.length) warnings.push('Kein Reiseverlauf erkannt — der Reiseplan bleibt leer.');
    const dates = draft.items.flatMap((item) => [item.date, item.endDate]).filter((date): date is string => Boolean(date));
    draft.startsOn = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : germanDate(head?.group(1));
    draft.endsOn = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    if (!draft.endsOn) warnings.push('Kein Reiseende erkannt.');

    draft.participants = parseParticipants(pages, draft.startsOn, warnings);
    if (!draft.participants.length) warnings.push('Keine Reiseteilnehmer erkannt.');

    // „Kunde:“ / „Mustermann Erika“ (Nachname zuerst) / Anschrift bis zur Zeile mit PLZ. Name auch hinter „Kunde:“.
    const [customer] = matchAll(pages, /Kunde:\s*([^\n]+)\n((?:[^\n]*\n){0,3}?[^\n]*\b\d{5}\b[^\n]*)/);
    const primary = draft.participants.find((p) => p.kind === 'PRIMARY') ?? draft.participants[0];
    if (customer) {
      const words = customer.group(0).toLowerCase().split(/\s+/);
      const participant = draft.participants.find((p) => words.every((word) => p.displayName.toLowerCase().split(/\s+/).includes(word)));
      draft.customer.displayName = participant?.displayName ?? customer.group(0);
      draft.customer.address =
        customer
          .group(1)
          .split('\n')
          .map(collapse)
          .filter(Boolean)
          .join(', ')
          .replace(/\b[A-Z]{1,2}\s?-\s?(?=\d{5}\b)/, '') || null;
    } else {
      draft.customer.displayName = primary?.displayName ?? null;
      if (primary) warnings.push('Kundenblock „Kunde:“ nicht erkannt — erste Reisende als Kundschaft übernommen, Anschrift fehlt.');
    }
    draft.customer.phone = matchFirst(pages, /^([+\d][\d ()/-]{5,})\s+Kundentelefonnummer:/m)?.value ?? null;

    const hotels = draft.items.filter((item) => item.kind === 'HOTEL');
    const places = [...new Set(hotels.map((item) => item.location).filter((place): place is string => Boolean(place)))];
    const flights = draft.items.filter((item) => item.kind === 'FLIGHT').map((item) => item.title);
    const region = guessRegion(`${places.join(' ')} ${flights.join(' ')} ${text.slice(0, 6_000)}`);
    draft.destinationCountry = region.country;
    if (region.timeZone) draft.destinationTimeZone = region.timeZone;
    if (hotels.length === 1 && hotels[0]) {
      draft.destination = places[0] ?? region.country;
      draft.title = [draft.destination, hotels[0].title].filter(Boolean).join(' · ');
    } else {
      draft.destination = region.country ?? places[0] ?? null;
      draft.title = [region.country, places.join(', ')].filter(Boolean).join(': ') || null;
    }

    draft.payments = parsePayments(pages, draft, warnings);
    draft.tasks = parseTasks(pages, draft.items, draft.reference, draft.payments);

    for (const board of new Set(hotels.map((hotel) => hotel.subtitle?.split(' · ')[1]).filter((b): b is string => Boolean(b)))) draft.inclusions.push(board);
    if (/RAIL\s*&\s*FLY/i.test(text)) draft.inclusions.push('Rail & Fly');
    const noTransfer = /Die Reise ist OHNE Transfer\s+([\s\S]{0,60}?)!/i.exec(text);
    if (noTransfer) draft.notes.push(`Ohne Transfer ${collapse((noTransfer[1] ?? '').replace(/-\s*\n\s*/g, '-'))}.`);
    if (/Rücktrittskostenvers\.\s*nicht gewünscht/.test(text)) draft.notes.push('Keine Reiserücktrittskostenversicherung über Schauinsland gebucht.');
    if (/für Klimaresilienz/.test(text)) draft.notes.push('Griechenland: Klimaabgabe vor Ort, je Zimmer und Tag nach Hotelkategorie.');

    // Kopf: Reisebüro nach den Datumswerten — Name / Anschrift (1–4 Zeilen, PLZ auch „D-12345“) / „Tel.: …“
    const [office] = matchAll(pages, new RegExp(`${DATE}\\s+${DATE}[ \\t]*\\n((?:[^\\n]+\\n){1,5}?)\\s*Tel(?:efon)?\\.?:?[ \\t]*([^\\n]*)`));
    const officeLines = office?.group(0).split('\n').map(collapse).filter(Boolean) ?? [];
    if (office && officeLines[0]) {
      draft.contacts.push({
        kind: 'ADVISOR',
        title: 'Ihr Reisebüro',
        name: officeLines[0],
        phone: office.group(1) || null,
        email: null,
        address: officeLines.slice(1).join(', ').replace(/\b[A-Z]{1,2}\s?-\s?(?=\d{5}\b)/, '') || null,
        notes: null
      });
    } else warnings.push('Reisebüro nicht erkannt.');
    const [organizer] = matchAll(pages, /^Schauinsland-Reisen GmbH\s*\n([^\n]+)\n(\d{5}[^\n]*)/m);
    draft.contacts.push({
      kind: 'OTHER',
      title: 'Veranstalter',
      name: draft.organizer,
      phone: null,
      email: null,
      address: organizer ? `${organizer.group(0)}, ${organizer.group(1)}` : null,
      notes: null
    });
    for (const hotel of hotels) {
      draft.contacts.push({ kind: 'HOTEL', title: hotel.title, name: hotel.title, phone: null, email: null, address: hotel.location, notes: hotel.subtitle });
    }

    return { draft, warnings };
  }
};
