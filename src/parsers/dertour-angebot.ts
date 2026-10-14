import type { DocumentParser, DraftEvidence, DraftItem, DraftParticipant, DraftTask, ParseResult } from '../core/draft.js';
import { emptyDraft } from '../core/draft.js';
import type { PdfPage } from '../core/pdf-text.js';
import { joinedText } from '../core/pdf-text.js';
import { collapse, euroCents, germanDate, guessRegion, matchAll, matchFirst, shiftDate } from '../core/text.js';

const DATE = '\\d{1,2}\\.\\d{1,2}\\.\\d{4}';
const STATUS = 'Angebot';

// Nicht in guessRegion: dort geändert, änderte sich das Ergebnis der TUI-Parser.
const REGIONS: readonly (readonly [RegExp, string, string])[] = [
  [/\b(?:Thailand|Bangkok|Phuket|Khao Lak|Krabi|Koh Samui|Chiang Mai)\b/i, 'Thailand', 'Asia/Bangkok']
];

interface Line {
  text: string;
  page: number;
}

/**
 * Zeilen der Tabelle „Reisepaket“, ohne Seitenkopf und -fuß. Die Tabelle läuft über
 * mehrere Seiten; jede Seite wiederholt den Kopf bis „Pos. Anz. Leistung“.
 */
function packageLines(pages: readonly PdfPage[]): Line[] {
  const lines: Line[] = [];
  for (const page of pages) {
    const rows = page.text.split('\n').map((row) => row.trim());
    const head = rows.findIndex((row) => /^Pos\.\s+Anz\.\s+Leistung/.test(row));
    if (head < 0) continue;
    for (const row of rows.slice(head + 1)) {
      if (/^Gesamtbetrag\b/.test(row)) return lines;
      // Seitenfuß. Auf Seite 1 steht er vor dem Inhalt, darum erst nach dem Tabellenkopf schneiden.
      if (/^DERTOUR · Eine Marke/.test(row)) break;
      if (row) lines.push({ text: row, page: page.pageNumber });
    }
  }
  return lines;
}

/** Positionen 1, 2, 3 … — fortlaufend, damit Hotelnamen mit Ziffern keine neue Position starten. */
function positions(lines: readonly Line[]): { header: string; lines: Line[] }[] {
  const blocks: { header: string; lines: Line[] }[] = [];
  for (const line of lines) {
    const start = /^(\d{1,2})\s+\d{1,2}\s+(\S.*)$/.exec(line.text);
    if (start && Number(start[1]) === blocks.length + 1) {
      blocks.push({ header: start[2] ?? '', lines: [line] });
    } else {
      blocks.at(-1)?.lines.push(line);
    }
  }
  return blocks;
}

function evidenceOf(lines: readonly Line[]): DraftEvidence {
  return { page: lines[0]?.page ?? 1, excerpt: collapse(lines.slice(0, 3).map((line) => line.text).join(' ')) };
}

const FLIGHT_ROW = new RegExp(
  `^(${DATE})\\s+([A-Z]{3})\\s+([A-Z]{3})\\s+(\\d{1,2}:\\d{2})\\s+(\\d{1,2}:\\d{2})(?:\\s+\\(\\+(\\d)\\))?\\s+` +
    `([A-Z0-9]{2}\\s?\\d{1,4})\\s+(Premium Economy|Economy|Business|First|\\S+)\\s+(.+)$`
);

function parseBlock(header: string, lines: readonly Line[]): DraftItem[] | null {
  const texts = lines.map((line) => line.text);
  const evidence = evidenceOf(lines);
  const base = { description: null, startTime: null, endDate: null, endTime: null, location: null, confirmationCode: null };

  const flights = texts.map((text) => FLIGHT_ROW.exec(text)).filter((row): row is RegExpExecArray => row !== null);
  if (flights.length) {
    // Strecke im Kopf, über Zeilen verteilt: „Frankfurt am Main - Bangkok“ / „Suvarnabhumi“ / „03.02.2027 1,2,3“
    const tableHead = texts.findIndex((text) => /^Datum\s+von\s+nach/.test(text));
    const route = collapse([header, ...texts.slice(1, tableHead < 0 ? 1 : tableHead)].join(' '))
      .replace(new RegExp(`\\s*${DATE}\\s+[\\d,]+$`), '')
      .split(/\s+-\s+/);
    const baggage = /je (\d+) Gepäckstück\(e\) á (\d+) kg/.exec(texts.join('\n'));
    return flights.map((row) => {
      const [, rawDate = '', from = '', to = '', departure = '', arrival = '', plusDays, flightNumber = '', cabin = '', airline = ''] = row;
      const date = germanDate(rawDate) ?? '';
      const [fromName, toName] = flights.length === 1 && route.length === 2 ? route : [from, to];
      return {
        ...base,
        kind: 'FLIGHT' as const,
        title: `Flug ${fromName} → ${toName}`,
        subtitle: [flightNumber.replace(/\s/g, ''), collapse(airline), cabin].join(' · '),
        description: baggage ? `Freigepäck je Person: ${baggage[1]} Gepäckstück à ${baggage[2]} kg` : null,
        date,
        startTime: departure,
        endDate: plusDays ? shiftDate(date, Number(plusDays), 'day') : date,
        endTime: arrival,
        location: `${toName} (${to})`,
        confirmationCode: flightNumber.replace(/\s/g, ''),
        statusLabel: STATUS,
        evidence
      };
    });
  }

  const rail = new RegExp(`^(Rail\\s*&\\s*Fly[^\\n]*?)\\s+von\\s+(${DATE})`).exec(header);
  if (rail) {
    const until = texts.map((text) => new RegExp(`^bis\\s+(${DATE})`).exec(text)?.[1]).find(Boolean);
    return [
      {
        ...base,
        kind: 'TRAIN',
        title: collapse(rail[1]),
        subtitle: 'Zug zum Flug',
        description: until ? `Gültig vom ${rail[2]} bis ${until}` : null,
        date: germanDate(rail[2]) ?? '',
        statusLabel: STATUS,
        evidence
      }
    ];
  }

  const stay = new RegExp(`vom\\s+(${DATE})[\\s\\S]*?bis\\s+(${DATE})`).exec(texts.join('\n'));
  if (stay) {
    // Ort in Klammern: im Kopf („Resort (Phuket)“) oder auf der nächsten Zeile („(Bangkok)“)
    const place = /\(([^()]+)\)\s*$/.exec(header)?.[1] ?? texts.map((text) => /^\(([^()]+)\)$/.exec(text)?.[1]).find((p) => p && !/Nächte/.test(p));
    const room = texts.find((text) => /^[^()]+\([A-Z0-9]{2,4}\)$/.test(text));
    const board = texts.map((text) => /^Verpflegung:\s*(.+)$/.exec(text)?.[1]).find(Boolean);
    const travelers = [...texts].reverse().find((text) => /^\d(?:,\d)*$/.test(text));
    return [
      {
        ...base,
        kind: 'HOTEL',
        title: collapse(header.replace(/\s*\([^()]+\)\s*$/, '')),
        subtitle: [room, board].filter(Boolean).join(' · ') || null,
        description: room && travelers ? `${room}: Reisende ${travelers.split(',').join(', ')}` : null,
        date: germanDate(stay[1]) ?? '',
        endDate: germanDate(stay[2]),
        location: place ?? null,
        statusLabel: STATUS,
        evidence
      }
    ];
  }

  if (/transfer/i.test(header)) {
    const date = texts.map((text) => new RegExp(`^(${DATE})\\s+[\\d,]+$`).exec(text)?.[1]).find(Boolean);
    return [
      {
        ...base,
        kind: 'TRANSFER',
        title: collapse(header.replace(/\s*\(Pauschal\)\s*$/, '')),
        subtitle: texts[1] && !new RegExp(`^${DATE}`).test(texts[1]) ? texts[1] : null,
        date: germanDate(date) ?? '',
        statusLabel: STATUS,
        evidence
      }
    ];
  }

  return null;
}

/** Zwei Zimmer im selben Hotel, gleiche Daten → ein Eintrag im Reiseplan. */
function mergeRooms(items: DraftItem[]): DraftItem[] {
  const merged: DraftItem[] = [];
  for (const item of items) {
    const same = merged.find(
      (other) => item.kind === 'HOTEL' && other.kind === 'HOTEL' && other.title === item.title && other.date === item.date && other.endDate === item.endDate
    );
    if (!same) {
      merged.push(item);
      continue;
    }
    const rooms = [same.subtitle, item.subtitle].map((s) => s?.split(' · ')[0]).filter(Boolean);
    const board = same.subtitle?.split(' · ')[1];
    same.subtitle = [[...new Set(rooms)].length === 1 ? `${rooms.length}× ${rooms[0]}` : rooms.join(', '), board].filter(Boolean).join(' · ');
    same.description = [same.description, item.description].filter(Boolean).join(' · ') || null;
  }
  return merged;
}

function parseParticipants(pages: readonly PdfPage[], warnings: string[]): DraftParticipant[] {
  // „1 Max Mustermann 30 3.170,00 EUR“, „3 Kind Tba Tbac 15/17.02.2012 3.170,00 EUR“
  const rows = matchAll(
    pages,
    new RegExp(`(?:^|\\n)(\\d)\\s+(Kind\\s+)?([^\\n\\d]{2,80}?)\\s+\\d{1,3}(?:\\/(${DATE}))?\\s+[\\d.]+,\\d{2}\\s+EUR(?=\\n)`, 'g')
  );
  const placeholders: string[] = [];
  const participants = rows.map(({ group }) => {
    const number = group(0);
    const child = Boolean(group(1));
    // DERTOUR setzt „Tba Tbab“ (to be announced), solange der Name fehlt.
    const placeholder = /^tba\b/i.test(group(2));
    if (placeholder) placeholders.push(number);
    return {
      displayName: placeholder ? `${child ? 'Kind' : 'Reisende/r'} ${number}` : collapse(group(2)),
      birthDate: germanDate(group(3)),
      kind: child ? ('CHILD' as const) : number === '1' ? ('PRIMARY' as const) : ('COMPANION' as const)
    };
  });
  if (placeholders.length) warnings.push(`Reisende ${placeholders.join(', ')} ohne Namen (Platzhalter „Tba“) — Namen nachtragen.`);
  return participants;
}

function parseTasks(pages: readonly PdfPage[], items: readonly DraftItem[]): DraftTask[] {
  const tasks: DraftTask[] = [];
  const tdac = matchFirst(pages, /digitale Einreisekarte[\s\S]{0,80}?innerhalb von\s+(\d{1,2})\s+Tagen vor Ankunft/i);
  const arrival = items.find((item) => item.kind === 'FLIGHT')?.endDate ?? null;
  if (tdac) {
    const link = matchFirst(pages, /(https?:\/\/tdac\.[^\s]+)/)?.value;
    tasks.push({
      title: 'Digitale Einreisekarte Thailand ausfüllen',
      description: `Frühestens ${tdac.value} Tage vor Ankunft, spätestens am Ankunftstag.${link ? ` ${link}` : ''}`,
      dueOn: shiftDate(arrival, -Number(tdac.value), 'day'),
      rule: `innerhalb von ${tdac.value} Tagen vor Ankunft (einschließlich des Ankunftsdatums)`,
      required: true,
      travelerVisible: true,
      evidence: tdac.evidence
    });
  }
  return tasks;
}

/**
 * DERTOUR — unverbindliches Angebot. Muster: test/fixtures/dertour-angebot-muster.txt (erfunden).
 * Damit beginnt die Reise in NADIA; Preise und Leistungen gelten erst bei Festbuchung.
 * Anleitung und Fallen: docs/neuer-parser.md, Vertrag: docs/vertrag.md
 */
export const dertourAngebotParser: DocumentParser = {
  id: 'dertour-angebot',
  version: '1.0.0',
  family: 'DERTOUR',
  label: 'DERTOUR — Unverbindliches Angebot',
  detect(pages) {
    const text = joinedText(pages);
    if (!/DERTOUR Deutschland GmbH/i.test(text)) return 0;
    return /^Unverbindliches Angebot$/m.test(text) ? 0.95 : 0.6;
  },
  parse(pages): ParseResult {
    const draft = emptyDraft();
    const warnings: string[] = [];
    draft.organizer = 'DERTOUR Deutschland GmbH';

    // Werte stehen vor ihrer Beschriftung: „22.09.2026“ / „999888777“ / „Vorgangsnummer“
    const [head] = matchAll(pages, new RegExp(`(${DATE})\\s*\\n\\s*(\\d{6,12})\\s*\\n\\s*Vorgangsnummer`));
    const offerDate = head?.group(0);
    draft.reference = head?.group(1) ?? matchFirst(pages, /(\d{6,12})\s*\n\s*Vorgangsnummer/)?.value ?? null;
    if (!draft.reference) warnings.push('Keine Vorgangsnummer erkannt.');
    // Kein Buchungsdatum: ein Angebot ist noch nicht gebucht.
    draft.summary = offerDate ? `Unverbindliches Angebot vom ${offerDate}` : 'Unverbindliches Angebot';
    draft.notes.push('Unverbindliches Angebot — Preise und Verfügbarkeit gelten erst bei Festbuchung.');

    draft.participants = parseParticipants(pages, warnings);
    if (!draft.participants.length) warnings.push('Keine Reisenden erkannt.');
    const applicant = matchFirst(pages, /Anmelder\/in der Reise\s*\n\s*([^\n]{3,80})/)?.value;
    draft.customer.displayName =
      draft.participants.find((p) => applicant && p.displayName.startsWith(applicant))?.displayName ?? applicant ?? null;

    const items: DraftItem[] = [];
    for (const { header, lines } of positions(packageLines(pages))) {
      const parsed = parseBlock(header, lines);
      if (parsed) items.push(...parsed);
      else warnings.push(`Position „${collapse(header)}“ nicht erkannt — bitte von Hand übernehmen.`);
    }
    draft.items = mergeRooms(items.filter((item) => item.date));
    if (!draft.items.length) warnings.push('Keine Reiseleistungen erkannt — der Reiseverlauf bleibt leer.');

    const dates = draft.items.flatMap((item) => [item.date, item.endDate]).filter((date): date is string => Boolean(date));
    draft.startsOn = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
    draft.endsOn = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    if (!draft.startsOn) {
      draft.startsOn = germanDate(matchFirst(pages, new RegExp(`Leistungsbeginn:\\s*(${DATE})`))?.value);
      if (draft.startsOn) warnings.push('Reisebeginn aus „Leistungsbeginn“, Reiseende fehlt.');
      else warnings.push('Kein Reisezeitraum erkannt.');
    }

    const places = [...new Set(draft.items.filter((item) => item.kind === 'HOTEL').map((item) => item.location).filter(Boolean))];
    const regionText = `${places.join(' ')} ${joinedText(pages).slice(0, 4_000)}`;
    const known = REGIONS.find(([pattern]) => pattern.test(regionText));
    const { country, timeZone } = known ? { country: known[1], timeZone: known[2] } : guessRegion(regionText);
    draft.destinationCountry = country;
    if (timeZone) draft.destinationTimeZone = timeZone;
    draft.destination = country ?? places[0] ?? null;
    draft.title = [country, places.join(', ')].filter(Boolean).join(': ') || null;

    const total = matchFirst(pages, /Gesamtbetrag\s+([\d.]+,\d{2})\s*EUR/);
    if (total) {
      draft.payments.push({
        kind: 'TOTAL',
        label: 'Gesamtbetrag (Angebot)',
        amountCents: euroCents(total.value),
        currency: 'EUR',
        dueOn: null,
        evidence: total.evidence
      });
    } else warnings.push('Kein Gesamtbetrag erkannt.');

    draft.tasks = parseTasks(pages, draft.items);

    const hotels = draft.items.filter((item) => item.kind === 'HOTEL');
    const boards = new Set(hotels.map((hotel) => hotel.subtitle?.split(' · ')[1]).filter((board): board is string => Boolean(board)));
    draft.inclusions.push(...boards);
    if (draft.items.some((item) => item.kind === 'TRAIN')) draft.inclusions.push('Rail & Fly');
    if (draft.items.some((item) => item.kind === 'TRANSFER')) draft.inclusions.push('Transfers');

    // „Buchungsstelle:“ / Name / Straße / PLZ Ort / „Telefon: …“ / „E-Mail: …“
    const [office] = matchAll(pages, /Buchungsstelle:\s*\n([^\n]+)\n([^\n]+)\n([^\n]+)\nTelefon:\s*([^\n]+)\nE-Mail:\s*(\S+)/);
    if (office) {
      draft.contacts.push({
        kind: 'ADVISOR',
        title: 'Ihr Reisebüro',
        name: office.group(0),
        phone: office.group(3),
        email: office.group(4),
        address: `${office.group(1)}, ${office.group(2)}`,
        notes: null
      });
    }
    draft.contacts.push({
      kind: 'OTHER',
      title: 'Veranstalter',
      name: draft.organizer,
      phone: null,
      email: null,
      address: matchFirst(pages, /DERTOUR Deutschland GmbH\s*·\s*([^\n·]{5,60}·[^\n·]{5,40})/)?.value ?? null,
      notes: null
    });
    for (const hotel of hotels) {
      draft.contacts.push({ kind: 'HOTEL', title: hotel.title, name: hotel.title, phone: null, email: null, address: hotel.location, notes: hotel.subtitle });
    }

    return { draft, warnings };
  }
};
