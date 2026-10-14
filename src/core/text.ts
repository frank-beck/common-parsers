import type { DraftEvidence } from './draft.js';
import type { PdfPage } from './pdf-text.js';

export interface Match {
  value: string;
  evidence: DraftEvidence;
}

const EXCERPT_RADIUS = 60;

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + length + EXCERPT_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

/** Erster Treffer über alle Seiten hinweg, mit Fundstelle. */
export function matchFirst(pages: readonly PdfPage[], pattern: RegExp, group = 1): Match | null {
  for (const page of pages) {
    const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(page.text);
    if (!match || match[group] === undefined || match.index === undefined) continue;
    const offset = match[0].indexOf(match[group]);
    const index = match.index + (offset >= 0 ? offset : 0);
    return {
      value: match[group].trim(),
      evidence: { page: page.pageNumber, excerpt: excerptAround(page.text, index, match[group].length) }
    };
  }
  return null;
}

export interface GroupMatch {
  /** Gruppe `n` als Text; nicht getroffene Gruppen liefern einen leeren String. */
  group(index: number): string;
  evidence: DraftEvidence;
}

/** Alle Treffer eines Musters, mit Fundstelle je Treffer. */
export function matchAll(pages: readonly PdfPage[], pattern: RegExp): GroupMatch[] {
  const results: GroupMatch[] = [];
  for (const page of pages) {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(page.text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      const groups = match.slice(1).map((group) => (group ?? '').trim());
      results.push({
        group: (index) => groups[index] ?? '',
        evidence: { page: page.pageNumber, excerpt: excerptAround(page.text, match.index, match[0].length) }
      });
    }
  }
  return results;
}

/** `15.01.2027` → `2027-01-15`. Gibt `null` zurück, wenn das Datum nicht existiert. */
export function germanDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(input.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = match[3] ?? '';
  const year = Number(rawYear.length === 2 ? `20${rawYear}` : rawYear);
  return isoDate(year, month, day);
}

export function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export type ShiftUnit = 'day' | 'week' | 'month';

/** Verschiebt ein `YYYY-MM-DD` um Tage, Wochen oder Monate. Negativ = vorher. */
export function shiftDate(date: string | null, amount: number, unit: ShiftUnit): string | null {
  if (!date || !Number.isInteger(amount)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (unit === 'month') {
    const target = parsed.getUTCDate();
    parsed.setUTCDate(1);
    parsed.setUTCMonth(parsed.getUTCMonth() + amount);
    const lastDay = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).getUTCDate();
    parsed.setUTCDate(Math.min(target, lastDay));
  } else {
    parsed.setUTCDate(parsed.getUTCDate() + amount * (unit === 'week' ? 7 : 1));
  }
  return parsed.toISOString().slice(0, 10);
}

/** `12.345,60 €` → `1234560`. Punkt ist Tausender-, Komma Dezimaltrenner. */
export function euroCents(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = /(-?)\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/.exec(input.replace(/\s/g, ''));
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const euros = Number((match[2] ?? '').replaceAll('.', ''));
  const cents = Number(match[3]);
  if (!Number.isFinite(euros) || !Number.isFinite(cents)) return null;
  return sign * (euros * 100 + cents);
}

export function collapse(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

/** `MUSTERFRAU/ERIKA` oder `Mustermann/Max Peter` → `Erika Musterfrau`. */
export function personName(raw: string | null | undefined): string {
  const cleaned = collapse(raw).replace(/^(Herr|Frau|Herrn)\s+/i, '');
  const [last, first] = cleaned.split('/');
  const parts = first ? [first, last] : [cleaned];
  return parts
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word === word.toUpperCase() ? word.charAt(0) + word.slice(1).toLowerCase() : word))
    .join(' ');
}

// Die Alternativen stehen in einer Gruppe: ohne sie gilt die Wortgrenze nur für
// den ersten Begriff und "Rom" trifft auch in "La Romana".
const COUNTRY_BY_KEYWORD: readonly (readonly [RegExp, string, string])[] = [
  [/\b(?:Mittelamerika|Belize|Costa Rica|Panama|Colón|Cartagena)\b/i, 'Mittelamerika', 'America/Panama'],
  [/\b(?:Karibik|Jamaika|La Romana|Dominikanische|Grand Cayman|Roatán)\b/i, 'Karibik', 'America/Santo_Domingo'],
  [/\b(?:Teneriffa|Kanarische Inseln|Gran Canaria|Fuerteventura|Lanzarote)\b/i, 'Spanien', 'Atlantic/Canary'],
  [/\b(?:Mallorca|Palma|Spanien|Barcelona)\b/i, 'Spanien', 'Europe/Madrid'],
  [/\b(?:Madeira|Funchal|Portugal|Lissabon)\b/i, 'Portugal', 'Europe/Lisbon'],
  [/\b(?:Italien|Bologna|Rom|Sizilien|Palermo|Sardinien|Cagliari|Neapel)\b/i, 'Italien', 'Europe/Rome'],
  [/\b(?:Griechenland|Kreta|Rhodos|Athen)\b/i, 'Griechenland', 'Europe/Athens'],
  [/\b(?:Türkei|Antalya|Istanbul)\b/i, 'Türkei', 'Europe/Istanbul'],
  [/\b(?:Japan|Tokio|Tokyo)\b/i, 'Japan', 'Asia/Tokyo'],
  [/\b(?:Namibia|Windhoek)\b/i, 'Namibia', 'Africa/Windhoek'],
  [/\b(?:Island|Reykjavik)\b/i, 'Island', 'Atlantic/Reykjavik'],
  [/\b(?:Norwegen|Oslo|Bergen|Nordkap)\b/i, 'Norwegen', 'Europe/Oslo'],
  [/\b(?:Ägypten|Hurghada|Kairo)\b/i, 'Ägypten', 'Africa/Cairo'],
  [/\b(?:Thailand|Bangkok|Phuket|Khao Lak|Krabi|Koh Samui|Chiang Mai)\b/i, 'Thailand', 'Asia/Bangkok']
];

/**
 * Grobe Herkunft für Land und Zeitzone. Bewusst konservativ: Was nicht sicher
 * erkannt wird, bleibt leer und wird von der Beratung gesetzt.
 */
export function guessRegion(text: string): { country: string | null; timeZone: string | null } {
  for (const [pattern, country, timeZone] of COUNTRY_BY_KEYWORD) {
    if (pattern.test(text)) return { country, timeZone };
  }
  return { country: null, timeZone: null };
}
