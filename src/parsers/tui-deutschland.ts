import type { DocumentParser, DraftItem, DraftTask, ParseResult, TripImportDraft } from '../core/draft.js';
import { emptyDraft } from '../core/draft.js';
import type { PdfPage } from '../core/pdf-text.js';
import { joinedText } from '../core/pdf-text.js';
import { collapse, euroCents, germanDate, guessRegion, matchAll, matchFirst, personName, shiftDate } from '../core/text.js';

const DATE = '\\d{1,2}\\.\\d{1,2}\\.\\d{4}';
const DASH = '[–—-]';

function parseFlights(pages: readonly PdfPage[]): DraftItem[] {
  // „04.07.2028 Hinflug“ oder, bei Ankunft am Folgetag, „16.02.2027 –“ / „17.02.2027“ / „Hinflug“.
  // Inlandsflüge einer Rundreise heißen nur „Flug“.
  const pattern = new RegExp(
    `(${DATE})(?:\\s*${DASH}\\s*\\n?\\s*(${DATE}))?\\s+(Hinflug|Rückflug|Flug)\\s*\\n` +
      `\\s*Voraussichtliche Flugzeit:\\s*(\\d{1,2}:\\d{2})\\s*${DASH}\\s*(\\d{1,2}:\\d{2})\\s*Uhr[^\\n]*\\n` +
      `\\s*([^\\n>]{2,60})>\\s*([^\\n]{2,60})\\n` +
      `\\s*([^\\n]{2,60})`,
    'g'
  );
  return matchAll(pages, pattern).flatMap(({ group, evidence }) => {
    const [rangeEnd, direction, departure, arrival, from, to, operator] = [
      group(1),
      group(2),
      group(3),
      group(4),
      group(5),
      group(6),
      group(7)
    ];
    const date = germanDate(group(0));
    if (!date) return [];
    // Landet der Flug nach Mitternacht, gehört die Ankunft auf den Folgetag — steht die Spanne da, gilt sie.
    const overnight = arrival < departure;
    const endDate = germanDate(rangeEnd) ?? (overnight ? shiftDate(date, 1, 'day') : date);
    return [
      {
        kind: 'FLIGHT' as const,
        title: `${direction} ${collapse(from)} → ${collapse(to)}`,
        subtitle: collapse(operator),
        description: null,
        date,
        startTime: departure || null,
        endDate,
        endTime: arrival || null,
        location: collapse(to),
        confirmationCode: /\b([A-Z]{1,3}\s?\d{2,5})\b/.exec(operator)?.[1]?.replace(/\s/g, '') ?? null,
        statusLabel: 'Bestätigt',
        evidence
      }
    ];
  });
}

function parseAccommodation(pages: readonly PdfPage[]): DraftItem[] {
  const pattern = new RegExp(
    `(${DATE})\\s*${DASH}\\s*\\n?\\s*(${DATE})\\s*\\n` +
      `\\s*Paket \\(Unterkunft\\)\\s*\\n` +
      `\\s*([^\\n]{3,80})\\n` +
      `\\s*([^\\n]{2,60})\\n` +
      `([\\s\\S]{0,2000}?)(?=\\n${DATE}|\\n[A-ZÄÖÜ][^\\n]{0,40}\\s/\\s)`,
    'g'
  );
  return matchAll(pages, pattern).flatMap(({ group, evidence }) => {
    const [rawEnd, hotel, place, block] = [group(1), group(2), group(3), group(4)];
    const date = germanDate(group(0));
    if (!date) return [];
    const room = /Zimmertyp:\s*([^\n]+)/.exec(block)?.[1];
    const board = /Ihre Verpflegung:\s*([^\n]+)/.exec(block)?.[1];
    const amenities = /Zimmerausstattung:\s*([^\n]+)/.exec(block)?.[1];
    const code = /\(([A-Z0-9]{4,12})\)\s*$/.exec(collapse(hotel))?.[1] ?? null;
    return [
      {
        kind: 'HOTEL' as const,
        title: collapse(hotel).replace(/\s*\([A-Z0-9]{4,12}\)\s*$/, ''),
        subtitle: [room && collapse(room), board && collapse(board)].filter(Boolean).join(' · ') || null,
        description: amenities ? collapse(amenities) : null,
        date,
        startTime: null,
        endDate: germanDate(rawEnd),
        endTime: null,
        location: collapse(place),
        confirmationCode: code,
        statusLabel: 'Bestätigt',
        evidence
      }
    ];
  });
}

function parseGroundServices(pages: readonly PdfPage[]): DraftItem[] {
  const pattern = new RegExp(`(${DATE})\\s+((?:Bustransfer|Kostenloses Zug zum Flug|Transfer|Minibus)[^\\n]{0,80})`, 'g');
  return matchAll(pages, pattern).flatMap(({ group, evidence }) => {
    const date = germanDate(group(0));
    if (!date) return [];
    // Teilnehmerspalte am Zeilenende: „ 1–5 im Paket“ oder nur „ 1“
    const label = collapse(group(1))
      .replace(/\s+(?:1[–—-]\d|\d[–—-]\d)\s.*$/, '')
      .replace(/\s+\d$/, '');
    const train = /Zug zum Flug/i.test(label);
    const minibus = /^Minibus/i.test(label);
    return [
      {
        kind: train ? ('TRAIN' as const) : ('TRANSFER' as const),
        title: train ? 'Zug zum Flug' : minibus ? 'Minibus-Transfer' : 'Bustransfer',
        subtitle: label.replace(/\s*\([A-Z0-9]{4,12}\)\s*$/, '') || null,
        description: null,
        date,
        startTime: null,
        endDate: null,
        endTime: null,
        location: null,
        confirmationCode: /\(([A-Z0-9]{4,12})\)/.exec(label)?.[1] ?? null,
        statusLabel: 'Im Paket enthalten',
        evidence
      }
    ];
  });
}

function parsePayments(pages: readonly PdfPage[]) {
  const payments: TripImportDraft['payments'] = [];
  const total = matchFirst(pages, /Gesamtpreis\s*:?\s*([\d.]+,\d{2})\s*€/);
  if (total) {
    payments.push({
      kind: 'TOTAL',
      label: 'Gesamtpreis',
      amountCents: euroCents(total.value),
      currency: 'EUR',
      dueOn: null,
      evidence: total.evidence
    });
  }
  for (const [label, kind] of [
    ['Anzahlung', 'DEPOSIT'],
    ['Restzahlung', 'BALANCE']
  ] as const) {
    const hit = matchFirst(
      pages,
      new RegExp(`${label}\\s*:\\s*([\\d.]+,\\d{2})\\s*€\\s*Fälligkeit\\s*:\\s*(${DATE})`, 'i'),
      0
    );
    if (!hit) continue;
    const parts = new RegExp(`${label}\\s*:\\s*([\\d.]+,\\d{2})\\s*€\\s*Fälligkeit\\s*:\\s*(${DATE})`, 'i').exec(hit.value);
    if (!parts) continue;
    payments.push({
      kind,
      label,
      amountCents: euroCents(parts[1]),
      currency: 'EUR',
      dueOn: germanDate(parts[2]),
      evidence: hit.evidence
    });
  }
  return payments;
}

function parseTasks(
  pages: readonly PdfPage[],
  startsOn: string | null,
  payments: TripImportDraft['payments']
): DraftTask[] {
  const tasks: DraftTask[] = [];

  // Optionsbuchung: „Ihr Urlaub ist bis zum 28.09.2026, 20:00 Uhr unverbindlich reserviert und wird danach automatisch gebucht.“
  const option = matchFirst(pages, new RegExp(`bis zum\\s+(${DATE}),?\\s*(?:\\d{1,2}:\\d{2}\\s*Uhr)?\\s+unverbindlich reserviert`, 'i'));
  if (option) {
    tasks.push({
      title: 'Reservierung wird automatisch gebucht',
      description: 'Bis dahin unverbindlich. Danach gilt die Buchung, Storno nur nach den Reisebedingungen.',
      dueOn: germanDate(option.value),
      rule: 'unverbindlich reserviert, danach automatisch gebucht',
      required: true,
      travelerVisible: false,
      evidence: option.evidence
    });
  }

  const balance = payments.find((payment) => payment.kind === 'BALANCE');
  const cardLimit = matchFirst(
    pages,
    /Prüfen Sie spätestens\s+eine Woche vor Fälligkeit Ihrer Zahlung\s+([^\n.]{5,90})/i
  );
  if (cardLimit && balance?.dueOn) {
    tasks.push({
      title: 'Kreditkartenlimit prüfen',
      description:
        'Die Restzahlung wird von der Kreditkarte eingezogen. Ohne ausreichendes Limit scheitert die Zahlung.',
      dueOn: shiftDate(balance.dueOn, -1, 'week'),
      rule: 'eine Woche vor Fälligkeit der Zahlung',
      required: true,
      travelerVisible: false,
      evidence: cardLimit.evidence
    });
  }

  const flex = matchFirst(pages, /bis einschließlich\s+(\d{1,2})\s+Tage vor Reisebeginn\s+flexibel umbuchen oder stornieren/i);
  if (flex) {
    tasks.push({
      title: 'Letzter Tag für kostenfreie Umbuchung oder Storno',
      description: 'Danach greifen die regulären Umbuchungs- und Stornobedingungen.',
      dueOn: shiftDate(startsOn, -Number(flex.value), 'day'),
      rule: `bis ${flex.value} Tage vor Reisebeginn (Flex Tarif)`,
      required: false,
      travelerVisible: true,
      evidence: flex.evidence
    });
  }

  const checkIn = matchFirst(pages, /Web Check-?in ist[^.]{0,80}?ab\s+(\d{1,2})\s+Tage vor Abflug möglich/i);
  if (checkIn) {
    tasks.push({
      title: 'Web-Check-in öffnet',
      description: 'Ab diesem Tag lässt sich online einchecken und der Sitzplatz wählen.',
      dueOn: shiftDate(startsOn, -Number(checkIn.value), 'day'),
      rule: `ab ${checkIn.value} Tage vor Abflug`,
      required: false,
      travelerVisible: true,
      evidence: checkIn.evidence
    });
  }

  for (const payment of payments) {
    if (payment.kind === 'TOTAL' || !payment.dueOn) continue;
    tasks.push({
      title: `${payment.label} fällig`,
      description: payment.amountCents
        ? `${(payment.amountCents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} ${payment.currency}`
        : null,
      dueOn: payment.dueOn,
      rule: null,
      required: true,
      travelerVisible: false,
      evidence: payment.evidence
    });
  }

  return tasks;
}

export const tuiDeutschlandParser: DocumentParser = {
  id: 'tui-deutschland',
  version: '1.1.1',
  family: 'TUI Deutschland',
  label: 'TUI Deutschland — Buchungsbestätigung / Rechnung',

  detect(pages) {
    const text = joinedText(pages);
    if (/TUI\s+Cruises/i.test(text)) return 0;
    let score = /TUI\s+Deutschland/i.test(text) ? 0.7 : 0;
    if (score === 0) return 0;
    if (/Buchung\s*:\s*\d{6,}/i.test(text)) score += 0.15;
    if (/Buchungsbestätigung|Buchung im Detail/i.test(text)) score += 0.15;
    return Math.min(score, 1);
  },

  parse(pages): ParseResult {
    const draft: TripImportDraft = emptyDraft();
    const warnings: string[] = [];

    draft.organizer = matchFirst(pages, /(TUI\s+Deutschland(?:\s+GmbH)?)/i)?.value ?? 'TUI Deutschland GmbH';
    draft.reference = matchFirst(pages, /Buchung\s*:\s*(\d{6,})/i)?.value ?? null;
    draft.bookingDate = germanDate(matchFirst(pages, new RegExp(`\\|\\s*Datum\\s*:\\s*(${DATE})`, 'i'))?.value);

    const greeting = matchFirst(pages, /Hallo\s+(?:Herr|Frau|Herrn)?\s*([^,\n]{3,60}),/i);
    if (greeting) draft.customer.displayName = personName(greeting.value);

    draft.participants = matchAll(
      pages,
      new RegExp(`(?:^|\\n)\\s*(\\d)\\s+(Herr|Frau|Herrn|Kind)\\s+([^\\n(]{3,60})\\((${DATE})\\)`, 'g')
    ).map(({ group }) => ({
      displayName: personName(group(2)),
      birthDate: germanDate(group(3)),
      kind: group(0) === '1' ? ('PRIMARY' as const) : group(1) === 'Kind' ? ('CHILD' as const) : ('COMPANION' as const)
    }));
    if (!draft.customer.displayName && draft.participants[0]) {
      draft.customer.displayName = draft.participants[0].displayName;
    }
    if (draft.participants.length === 0) warnings.push('Keine Teilnehmer erkannt.');

    const items = [...parseFlights(pages), ...parseAccommodation(pages), ...parseGroundServices(pages)];
    draft.items = items;
    if (items.length === 0) warnings.push('Keine Reiseleistungen erkannt — der Reiseverlauf bleibt leer.');

    const dates = items.flatMap((item) => [item.date, item.endDate]).filter((date): date is string => Boolean(date));
    draft.startsOn = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
    draft.endsOn = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    if (!draft.startsOn) {
      draft.startsOn = germanDate(matchFirst(pages, new RegExp(`Versicherungsbeginn\\s*:\\s*(${DATE})`, 'i'))?.value);
      draft.endsOn = draft.startsOn;
      warnings.push('Reisezeitraum aus dem Vertragsbeginn abgeleitet — bitte prüfen.');
    }
    // TUI schreibt „Herr“/„Frau“ auch vor Minderjährige; Kind ist, wer bei Reisebeginn unter 18 ist.
    const adultSince = shiftDate(draft.startsOn, -18 * 12, 'month');
    for (const participant of draft.participants) {
      if (participant.kind === 'COMPANION' && participant.birthDate && adultSince && participant.birthDate > adultSince) {
        participant.kind = 'CHILD';
      }
    }

    const hotels = items.filter((item) => item.kind === 'HOTEL');
    const hotel = hotels[0];
    if (hotels.length > 1) {
      // Rundreise: Ziel ist das Land, Titel die Stationen
      const places = [...new Set(hotels.map((item) => item.location).filter((place): place is string => Boolean(place)))];
      const region = guessRegion(`${places.join(' ')} ${joinedText(pages).slice(0, 4_000)}`);
      draft.destinationCountry = region.country;
      if (region.timeZone) draft.destinationTimeZone = region.timeZone;
      draft.destination = region.country ?? places[0] ?? null;
      draft.title = [region.country, places.join(', ')].filter(Boolean).join(': ') || null;
      draft.summary = hotels.map((item) => item.title).join(' · ');
    } else {
      const arrival = items.find((item) => item.kind === 'FLIGHT' && /^Hinflug/.test(item.title));
      const airportCity = arrival?.location?.replace(/\s*\([A-Z]{3}\)\s*$/, '').replace(/\s+(Süd|Nord|West|Ost)$/i, '');
      draft.destination = collapse(airportCity ?? hotel?.location ?? '') || null;
      draft.title = hotel ? `${draft.destination ?? 'Reise'} · ${hotel.title}` : (draft.destination ?? null);
      draft.summary = hotel?.subtitle ?? null;

      const region = guessRegion(`${draft.destination ?? ''} ${hotel?.location ?? ''} ${joinedText(pages).slice(0, 4_000)}`);
      draft.destinationCountry = region.country;
      if (region.timeZone) draft.destinationTimeZone = region.timeZone;
    }

    draft.payments = parsePayments(pages);
    if (draft.payments.filter((payment) => payment.kind !== 'TOTAL').length === 0) {
      warnings.push('Keine Zahlungstermine erkannt.');
    }
    draft.tasks = parseTasks(pages, draft.startsOn, draft.payments);

    const baggage = matchFirst(pages, /Pro Person ist\s+(\d)\s+Freigepäckstück mit\s+(\d{1,3})\s*kg inkludiert/i, 0);
    if (baggage) draft.notes.push(collapse(baggage.value));
    const minimumAge = matchFirst(pages, /gilt ein Mindestalter von\s+(\d{1,2})\s+Jahren/i, 0);
    if (minimumAge) draft.notes.push(collapse(minimumAge.value));
    const boards = hotels.map((item) => item.subtitle?.match(/(Halbpension|Vollpension|All Inclusive|Frühstück)/i)?.[1]);
    for (const board of new Set(boards.filter((b): b is string => Boolean(b)))) draft.inclusions.push(board);
    if (items.some((item) => item.title === 'Bustransfer')) draft.inclusions.push('Bustransfer');
    if (items.some((item) => item.title === 'Minibus-Transfer')) draft.inclusions.push('Minibus-Transfer');
    if (items.some((item) => item.kind === 'TRAIN')) draft.inclusions.push('Zug zum Flug');

    // Block „Ihre Daten# Agentur oder Reisebüro#“: erst Kundschaft, nach „Versand des Reiseplans“ das Reisebüro.
    const [customerBlock] = matchAll(
      pages,
      /Ihre Daten#[^\n]*\n(?:Herrn?|Frau)?\s*[^\n]+\n([^\n]+)\n([^\n]+)\n(?:Telefon:\s*([^\n]+)\n)?(?:Telefon Mobil:\s*([^\n]+)\n)?(?:E-Mail:\s*(\S+))?/
    );
    if (customerBlock) {
      draft.customer.address = `${customerBlock.group(0)}, ${customerBlock.group(1).replace(/^[A-Z]{1,2}\s?-\s?/, '')}`;
      draft.customer.phone = customerBlock.group(3) || customerBlock.group(2) || null;
      draft.customer.email = customerBlock.group(4) || null;
    }
    const [office] = matchAll(
      pages,
      /Versand des Reiseplans:[^\n]*\n([^\n]+)\n([^\n]+)\n([^\n]+)\n(?:Telefon:\s*([^\n]+)\n)?(?:E-Mail:\s*(\S+))?/
    );
    // Ohne den Block: Firmenname mit „Reisen“/„Reisebüro“, keine Überschrift („…#“)
    const advisor = office
      ? null
      : matchFirst(pages, /\n(TS Traumreisen GmbH|[A-ZÄÖÜ][^\n#]{2,60}(?:Reisen|Reisebüro)[^\n#]{0,20})\n/);
    if (office) {
      draft.contacts.push({
        kind: 'ADVISOR',
        title: 'Ihr Reisebüro',
        name: office.group(0),
        phone: office.group(3) || null,
        email: office.group(4) || null,
        address: `${office.group(1)}, ${office.group(2).replace(/^[A-Z]{1,2}\s?-\s?/, '')}`,
        notes: null
      });
    } else if (advisor) {
      draft.contacts.push({
        kind: 'ADVISOR',
        title: 'Ihr Reisebüro',
        name: collapse(advisor.value),
        phone: null,
        email: null,
        address: null,
        notes: null
      });
    }
    draft.contacts.push({
      kind: 'OTHER',
      title: 'Veranstalter',
      name: draft.organizer,
      phone: matchFirst(pages, /Telefonnummer:\s*(\+49[\d\s-]{8,24})/)?.value ?? null,
      email: matchFirst(pages, /E-Mail-Adresse:\s*([a-z0-9._%-]+@tui\.de)/i)?.value ?? null,
      address: matchFirst(pages, /TUI Deutschland GmbH\s*·\s*([^\n·]{5,60}·[^\n]{5,40})/)?.value ?? null,
      notes: null
    });
    for (const item of hotels) {
      draft.contacts.push({
        kind: 'HOTEL',
        title: item.title,
        name: item.title,
        phone: null,
        email: null,
        address: item.location,
        notes: item.subtitle
      });
    }

    return { draft, warnings };
  }
};
