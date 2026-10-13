import type { PdfPage } from './pdf-text.js';

export type DraftItemKind = 'FLIGHT' | 'TRAIN' | 'TRANSFER' | 'HOTEL' | 'ACTIVITY' | 'MEAL' | 'NOTE';
export type DraftContactKind = 'ADVISOR' | 'EMERGENCY' | 'LOCAL_PARTNER' | 'HOTEL' | 'TRANSPORT' | 'INSURANCE' | 'OTHER';
export type DraftParticipantKind = 'PRIMARY' | 'COMPANION' | 'CHILD';

/** Belegstelle eines erkannten Werts: Seite plus Textausschnitt zum Nachschlagen. */
export interface DraftEvidence {
  page: number;
  excerpt: string;
}

export interface DraftItem {
  kind: DraftItemKind;
  title: string;
  subtitle: string | null;
  description: string | null;
  /** Lokales Datum `YYYY-MM-DD`; die Uhrzeit steht getrennt, weil viele Belege keine liefern. */
  date: string;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  location: string | null;
  confirmationCode: string | null;
  statusLabel: string | null;
  evidence: DraftEvidence | null;
}

export interface DraftTask {
  title: string;
  description: string | null;
  /** `YYYY-MM-DD`, aus der Regel berechnet. `null`, wenn der Bezugstermin fehlt. */
  dueOn: string | null;
  /** Die Regel im Wortlaut des Belegs, z. B. „spätestens 6 Wochen vor Abreise“. */
  rule: string | null;
  required: boolean;
  /** Erscheint in der Kundensicht. Interne Aufgaben bleiben beim Reisebüro. */
  travelerVisible: boolean;
  evidence: DraftEvidence | null;
}

export interface DraftPayment {
  kind: 'DEPOSIT' | 'BALANCE' | 'TOTAL';
  label: string;
  amountCents: number | null;
  currency: string;
  dueOn: string | null;
  evidence: DraftEvidence | null;
}

export interface DraftParticipant {
  displayName: string;
  birthDate: string | null;
  kind: DraftParticipantKind;
}

export interface DraftContact {
  kind: DraftContactKind;
  title: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface DraftCustomer {
  displayName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface TripImportDraft {
  organizer: string | null;
  reference: string | null;
  bookingDate: string | null;
  title: string | null;
  destination: string | null;
  destinationCountry: string | null;
  destinationTimeZone: string;
  summary: string | null;
  startsOn: string | null;
  endsOn: string | null;
  customer: DraftCustomer;
  participants: DraftParticipant[];
  items: DraftItem[];
  tasks: DraftTask[];
  payments: DraftPayment[];
  contacts: DraftContact[];
  inclusions: string[];
  notes: string[];
}

export interface ParseResult {
  draft: TripImportDraft;
  warnings: string[];
}

export interface DocumentParser {
  /** Stabil über Versionen. Kleinbuchstaben, Ziffern, Bindestrich. */
  id: string;
  /** SemVer. Jede Änderung am Ergebnis hebt die Version. */
  version: string;
  family: string;
  label: string;
  /**
   * Greift, wenn kein anderer Parser erkennt. Genau einer hat das Feld.
   * Er wird beim Erkennen übersprungen.
   */
  fallback?: boolean;
  /** 0 bis 1. Ab 0.8 gilt der Beleg als sicher erkannt. */
  detect(pages: readonly PdfPage[]): number;
  parse(pages: readonly PdfPage[]): ParseResult;
}

export function emptyDraft(): TripImportDraft {
  return {
    organizer: null,
    reference: null,
    bookingDate: null,
    title: null,
    destination: null,
    destinationCountry: null,
    destinationTimeZone: 'Europe/Berlin',
    summary: null,
    startsOn: null,
    endsOn: null,
    customer: { displayName: null, email: null, phone: null, address: null },
    participants: [],
    items: [],
    tasks: [],
    payments: [],
    contacts: [],
    inclusions: [],
    notes: []
  };
}
