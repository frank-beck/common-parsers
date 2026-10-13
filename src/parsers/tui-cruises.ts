import type { DocumentParser, DraftItem, DraftTask, ParseResult, TripImportDraft } from '../core/draft.js';
import { emptyDraft } from '../core/draft.js';
import type { PdfPage } from '../core/pdf-text.js';
import { joinedText } from '../core/pdf-text.js';
import { collapse, euroCents, germanDate, guessRegion, isoDate, matchAll, matchFirst, personName, shiftDate } from '../core/text.js';

const CLASS_PATTERN = '(?:Business|Economy|Premium Economy|First)\\s*Class';

/** Reihenfolge der Häfen einer Kreuzfahrt aus dem verketteten Routentext. */
/**
 * Reihenfolge der Häfen aus dem verketteten Routentext.
 *
 * Die Häfen stehen als eine Kette `Datum Ort - Datum Ort - …`, die über
 * Zeilenumbrüche hinweg umbricht. Begrenzt wird die Kette durch den
 * Kabinenzeitraum — sonst zieht sie den nachfolgenden Belegtext mit hinein.
 */
function parseRoute(pages: readonly PdfPage[], rangeStart: string | null, rangeEnd: string | null) {
  type Entry = { date: string; rest: string; index: number; page: number; opensChain: boolean };
  let best: Entry[] = [];

  for (const page of pages) {
    const chunks = page.text.split(/\s*-\s*(?=\d{1,2}\.\d{1,2}\.\d{4}(?:\s|$))/);
    const entries: Entry[] = [];
    chunks.forEach((chunk, index) => {
      const head = /^(\d{1,2}\.\d{1,2}\.\d{4})\s*([\s\S]*)$/.exec(chunk.trim());
      const headDate = germanDate(head?.[1]);
      if (head && headDate) {
        entries.push({ date: headDate, rest: head[2] ?? '', index, page: page.pageNumber, opensChain: false });
      }

      // Der Einschiffungshafen eröffnet die Kette und steht deshalb am Ende
      // seines Abschnitts — davor liegt noch anderer Belegtext.
      const lastLine = chunk.trimEnd().split('\n').at(-1)?.trim() ?? '';
      const tail = /^(\d{1,2}\.\d{1,2}\.\d{4})\s+([^\n]+)$/.exec(lastLine);
      const tailDate = germanDate(tail?.[1]);
      if (tail && tailDate && tailDate !== headDate) {
        entries.push({ date: tailDate, rest: tail[2] ?? '', index, page: page.pageNumber, opensChain: true });
      }
    });

    // Die längste Kette aufeinanderfolgender Tage ist der Routenplan. Einzelne
    // Datumsspannen (Flug, Versicherung) bilden keine Kette und fallen heraus.
    for (let start = 0; start < entries.length; start += 1) {
      const first = entries[start];
      if (!first) continue;
      const run: Entry[] = [first];
      for (let next = start + 1; next < entries.length; next += 1) {
        const candidate = entries[next];
        const previous = run.at(-1);
        if (!candidate || !previous || candidate.opensChain) continue;
        if (candidate.index !== previous.index + 1) continue;
        const gap = (Date.parse(candidate.date) - Date.parse(previous.date)) / 86_400_000;
        if (gap < 1 || gap > 3) break;
        run.push(candidate);
      }
      if (run.length > best.length) best = run;
    }
  }

  const bounded = best.filter(
    (entry) => (!rangeStart || entry.date >= rangeStart) && (!rangeEnd || entry.date <= rangeEnd)
  );
  if (bounded.length < 3) return [];

  return bounded.map((entry, index) => {
    // Der letzte Hafen endet am Zeilenumbruch — danach beginnt der nächste
    // Abschnitt des Belegs. Alle anderen enden am Trennzeichen der Kette.
    const lines = entry.rest.split('\n').map((line) => line.trim()).filter(Boolean);
    const raw = index === bounded.length - 1 ? (lines[0] ?? '') : lines.join(' ');
    return { date: entry.date, name: collapse(raw).slice(0, 60), page: entry.page };
  });
}

function parseFlights(pages: readonly PdfPage[]): DraftItem[] {
  const pattern = new RegExp(
    `(\\d{1,2}\\.\\d{1,2}\\.\\d{4})\\s*(?:-\\s*(\\d{1,2}\\.\\d{1,2}\\.\\d{4})\\s*)?\\n?\\s*` +
      `([A-ZÄÖÜ][^\\n/]{2,40}?)\\s+-\\s+([A-ZÄÖÜ][^\\n/]{2,40}?)/(\\d{1,3})\\s*\\n\\s*(${CLASS_PATTERN})`,
    'g'
  );
  return matchAll(pages, pattern).flatMap(({ group, evidence }) => {
    const date = germanDate(group(0));
    const [end, from, to, travelClass] = [group(1), group(2), group(3), group(5)];
    if (!date) return [];
    return [
      {
        kind: 'FLIGHT' as const,
        title: `Flug ${collapse(from)} → ${collapse(to)}`,
        subtitle: collapse(travelClass),
        description: 'Die genauen Flugzeiten gibt der Veranstalter erst später bekannt.',
        date,
        startTime: null,
        endDate: germanDate(end),
        endTime: null,
        location: collapse(to),
        confirmationCode: null,
        statusLabel: 'Zeiten offen',
        evidence
      }
    ];
  });
}

function parseCabin(pages: readonly PdfPage[]): DraftItem | null {
  const pattern =
    /(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*\n?\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*\n\s*(Mein Schiff\s*\d+)\s*\n\s*([^\n]{3,80})\s*\n\s*(Deck[^\n]{3,80})/;
  const hit = matchAll(pages, new RegExp(pattern.source, 'g'))[0];
  if (!hit) return null;
  const [end, ship, category, deck] = [hit.group(1), hit.group(2), hit.group(3), hit.group(4)];
  const date = germanDate(hit.group(0));
  if (!date) return null;
  return {
    kind: 'HOTEL',
    title: collapse(ship),
    subtitle: collapse(category),
    description: collapse(deck),
    date,
    startTime: null,
    endDate: germanDate(end),
    endTime: null,
    location: collapse(ship),
    confirmationCode: null,
    statusLabel: 'Kabine bestätigt',
    evidence: hit.evidence
  };
}

function parseTasks(pages: readonly PdfPage[], startsOn: string | null, endsOn: string | null): DraftTask[] {
  const tasks: DraftTask[] = [];

  const manifest = matchFirst(pages, /Schiffsmanifest[^.]{0,80}?bis spätestens\s+(\d{1,2})\s+Wochen\s+vor\s+Abreise/i);
  if (manifest) {
    tasks.push({
      title: 'Schiffsmanifest übermitteln',
      description:
        'Ohne vollständiges Manifest verschickt die Reederei keine Reiseunterlagen und die Einschiffung ist nicht möglich.',
      dueOn: shiftDate(startsOn, -Number(manifest.value), 'week'),
      rule: `spätestens ${manifest.value} Wochen vor Abreise`,
      required: true,
      travelerVisible: true,
      evidence: manifest.evidence
    });
  }

  const documents = matchFirst(pages, /Reiseunterlagen erhalten Sie frühestens\s+(\d{1,2})\s+Tage\s+vor/i);
  if (documents) {
    tasks.push({
      title: 'Reiseunterlagen treffen ein',
      description: 'Die Reederei versendet die Unterlagen per E-Mail, sobald das Manifest vollständig ist.',
      dueOn: shiftDate(startsOn, -Number(documents.value), 'day'),
      rule: `frühestens ${documents.value} Tage vor Abreise`,
      required: false,
      travelerVisible: true,
      evidence: documents.evidence
    });
  }

  const flightTimes = matchFirst(pages, /Flugzeiten erfolgt frühestens ab\s+(\d{1,2})\s+Monate?\s+vor\s+Abreise/i);
  if (flightTimes) {
    tasks.push({
      title: 'Flugzeiten prüfen',
      description: 'Ab diesem Zeitpunkt veröffentlicht der Veranstalter die Flugzeiten im Reiseportal.',
      dueOn: shiftDate(startsOn, -Number(flightTimes.value), 'month'),
      rule: `frühestens ${flightTimes.value} Monate vor Abreise`,
      required: false,
      travelerVisible: true,
      evidence: flightTimes.evidence
    });
  }

  const passport = matchFirst(
    pages,
    /Reisepass, der noch min\.?\s*(\d{1,2})\s+Monate\s+nach\s+Reiseende\s+gültig/i
  );
  if (passport) {
    tasks.push({
      title: 'Reisepass auf Gültigkeit prüfen',
      description: `Der Pass muss nach dem Reiseende noch mindestens ${passport.value} Monate gültig sein.`,
      dueOn: shiftDate(startsOn, -1, 'month'),
      rule: `Pass gültig bis mindestens ${shiftDate(endsOn, Number(passport.value), 'month') ?? 'Reiseende + ' + passport.value + ' Monate'}`,
      required: true,
      travelerVisible: true,
      evidence: passport.evidence
    });
  }

  const identityCard = matchFirst(
    pages,
    /benötigen einen Personalausweis bzw\.\s*eine Identitätskarte[^.]{0,120}\./i,
    0
  );
  if (!passport && identityCard) {
    tasks.push({
      title: 'Ausweisdokument prüfen',
      description: collapse(identityCard.value),
      dueOn: shiftDate(startsOn, -1, 'month'),
      rule: null,
      required: true,
      travelerVisible: true,
      evidence: identityCard.evidence
    });
  }

  return tasks;
}

function parsePayments(pages: readonly PdfPage[]) {
  // pdfjs liefert bei diesen Belegen den Betrag vor der Beschriftung.
  const pattern = /([\d.]+,\d{2})\s*€\s*(Anzahlung|Restzahlung)\s*\(([^)]*)\)/g;
  const payments: TripImportDraft['payments'] = matchAll(pages, pattern).flatMap(({ group, evidence }) => {
    const [amount, label, rule] = [group(0), group(1), group(2)];
    const due = /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(rule)?.[1];
    return [
      {
        kind: label.toLowerCase() === 'anzahlung' ? ('DEPOSIT' as const) : ('BALANCE' as const),
        label,
        amountCents: euroCents(amount),
        currency: 'EUR',
        dueOn: germanDate(due),
        evidence
      }
    ];
  });

  const total = matchFirst(pages, /Gesamtpreis\s+([\d.]+,\d{2})\s*€/);
  if (total) {
    payments.unshift({
      kind: 'TOTAL',
      label: 'Gesamtpreis',
      amountCents: euroCents(total.value),
      currency: 'EUR',
      dueOn: null,
      evidence: total.evidence
    });
  }
  return payments;
}

export const tuiCruisesParser: DocumentParser = {
  id: 'tui-cruises',
  version: '1.0.0',
  family: 'TUI Cruises / Mein Schiff',
  label: 'TUI Cruises — Reisebestätigung / Rechnung',

  detect(pages) {
    const text = joinedText(pages);
    let score = /TUI\s+Cruises/i.test(text) ? 0.7 : 0;
    if (score === 0) return 0;
    if (/Vorgang-?Nr\./i.test(text)) score += 0.15;
    if (/Reisebestätigung\s*\/\s*Rechnung|Bestätigung\s*\/\s*Rechnung/i.test(text)) score += 0.15;
    return Math.min(score, 1);
  },

  parse(pages): ParseResult {
    const draft: TripImportDraft = emptyDraft();
    const warnings: string[] = [];
    const text = joinedText(pages);

    draft.organizer = matchFirst(pages, /(TUI\s+Cruises(?:\s+GmbH)?)/i)?.value ?? 'TUI Cruises GmbH';
    draft.reference = matchFirst(pages, /Vorgang-?Nr\.?\s*:?\s*([0-9]{4,}(?:\/\d+)?)/i)?.value ?? null;
    draft.bookingDate = germanDate(matchFirst(pages, /Datum\s*:\s*(\d{1,2}\.\d{1,2}\.\d{4})/i)?.value);

    // Im zweispaltigen Kopf steht der Wert je nach Feld vor oder hinter der Beschriftung.
    const ship =
      matchFirst(pages, /^(.{3,40}?)\s*Ihr Schiff\s*:/m) ?? matchFirst(pages, /Ihr Schiff\s*:[ \t]*([^\n]{3,40})/i);
    const cruise = matchFirst(pages, /Ihre Reise\s*:\s*([^\n]{3,120})/i);
    draft.title = cruise ? collapse(cruise.value) : null;
    draft.summary = ship ? `${collapse(ship.value)} · ${draft.title ?? 'Kreuzfahrt'}` : draft.title;

    const period = matchFirst(pages, /Ihr Reisedatum\s*:\s*(\d{1,2}\.\d{1,2}\.\s*(?:\d{4}\s*)?-\s*\d{1,2}\.\d{1,2}\.\d{4})/i);
    if (period) {
      const parts = /(\d{1,2})\.(\d{1,2})\.\s*(\d{4})?\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(period.value);
      if (parts) {
        const endYear = Number(parts[6]);
        draft.startsOn = isoDate(Number(parts[3] ?? parts[6]), Number(parts[2]), Number(parts[1]));
        draft.endsOn = isoDate(endYear, Number(parts[5]), Number(parts[4]));
      }
    }
    if (!draft.startsOn || !draft.endsOn) warnings.push('Reisezeitraum nicht erkannt — bitte Beginn und Ende setzen.');

    // Zielgebiet aus dem Reisetitel, nicht aus dem Fließtext des ganzen Belegs.
    const destinationSource = draft.title ?? '';
    draft.destination = collapse(destinationSource.replace(/^\d+\s*Nächte\s*-\s*/i, '').split(' - ab/bis ')[0] ?? '') || null;
    const region = guessRegion(destinationSource);
    draft.destinationCountry = region.country;
    if (region.timeZone) draft.destinationTimeZone = region.timeZone;

    const recipient = matchFirst(pages, /\n(?:Herr|Frau|Herrn)\s*\n([^\n]{3,60})\n([^\n]{3,60})\n(\d{5}\s+[^\n]{2,50})/);
    if (recipient) {
      const block = /\n(?:Herr|Frau|Herrn)\s*\n([^\n]{3,60})\n([^\n]{3,60})\n(\d{5}\s+[^\n]{2,50})/.exec(text);
      draft.customer.displayName = personName(block?.[1] ?? recipient.value);
      draft.customer.address = block ? collapse(`${block[2]}, ${block[3]}`) : null;
    }

    const participants = matchAll(
      pages,
      /[\d.]+,\d{2}\s*€\s*(\d)\.\s+(?:Herr|Frau|Herrn)\s+([^\n]{3,60}?)\s+(\d{1,2}\.\d{1,2}\.\d{4})/g
    );
    draft.participants = participants.map(({ group }) => ({
      displayName: personName(group(1)),
      birthDate: germanDate(group(2)),
      kind: group(0) === '1' ? ('PRIMARY' as const) : ('COMPANION' as const)
    }));
    if (!draft.customer.displayName && draft.participants[0]) {
      draft.customer.displayName = draft.participants[0].displayName;
    }
    if (draft.participants.length === 0) warnings.push('Keine Teilnehmer erkannt.');

    const items: DraftItem[] = [];
    const cabin = parseCabin(pages);
    if (cabin) items.push(cabin);
    items.push(...parseFlights(pages));

    // Der Routenplan endet mit der Kabine, nicht mit der Reise: nach dem letzten
    // Hafen folgen im Beleg noch Rückflug und Versicherungshinweis.
    const route = parseRoute(pages, cabin?.date ?? draft.startsOn, cabin?.endDate ?? draft.endsOn);
    for (const stop of route) {
      const seaDay = /^Seetag/i.test(stop.name);
      items.push({
        kind: seaDay ? 'NOTE' : 'ACTIVITY',
        title: seaDay ? 'Seetag' : stop.name,
        subtitle: seaDay ? null : 'Hafen',
        description: null,
        date: stop.date,
        startTime: null,
        endDate: null,
        endTime: null,
        location: seaDay ? null : stop.name,
        confirmationCode: null,
        statusLabel: null,
        evidence: { page: stop.page, excerpt: `${stop.date} ${stop.name}` }
      });
    }
    if (route.length === 0) warnings.push('Kein Routenplan erkannt — der Reiseverlauf bleibt leer.');
    draft.items = items;

    draft.tasks = parseTasks(pages, draft.startsOn, draft.endsOn);
    draft.payments = parsePayments(pages);
    for (const payment of draft.payments) {
      if (payment.kind === 'TOTAL' || !payment.dueOn) continue;
      draft.tasks.push({
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
    if (draft.payments.filter((payment) => payment.kind !== 'TOTAL').length === 0) {
      warnings.push('Keine Zahlungstermine erkannt.');
    }

    // Nur allein stehende Zeilen zählen. Im Fließtext werden alle Tarifnamen
    // erklärt ("PRO- und PLUS-Tarif: inkl. …") — gebucht ist aber nur einer.
    draft.inclusions = [
      ...new Set(
        matchAll(pages, /^[ \t]*((?:Premium|Deluxe) Alles Inklusive|[\wÄÖÜäöü&. -]{3,40} Inklusive|(?:PRO|PLUS|PUR)-Tarif)[ \t]*$/gm).map(
          ({ group }) => collapse(group(0))
        )
      )
    ];

    const advisor = matchFirst(pages, /Änderungswünsche an\s*:\s*\n([^\n]{3,80})\n[^\n]*\nTel:\s*([+\d\s()/-]{6,30})/);
    if (advisor) {
      const block = /Änderungswünsche an\s*:\s*\n([^\n]{3,80})\n[^\n]*\nTel:\s*([+\d\s()/-]{6,30})/.exec(text);
      draft.contacts.push({
        kind: 'ADVISOR',
        title: 'Ihr Reisebüro',
        name: collapse(block?.[1] ?? advisor.value),
        phone: block ? collapse(block[2]) : null,
        email: null,
        address: null,
        notes: null
      });
    }
    draft.contacts.push({
      kind: 'TRANSPORT',
      title: 'Reederei',
      name: draft.organizer,
      phone: matchFirst(pages, /Tel\.\s*(\+49[\d\s-]{8,24})/)?.value ?? null,
      email: matchFirst(pages, /([a-z0-9._%-]+@tuicruises\.com)/i)?.value ?? null,
      address: null,
      notes: null
    });

    return { draft, warnings };
  }
};
