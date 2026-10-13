import type { DocumentParser } from './draft.js';
import type { PdfPage } from './pdf-text.js';

/** Ab diesem Wert gilt ein Beleg als sicher erkannt. */
export const DETECT_THRESHOLD = 0.8;

export interface ParserMatch {
  parser: DocumentParser;
  confidence: number;
}

/**
 * Wählt den Parser mit der höchsten Trefferwahrscheinlichkeit. Kein Treffer
 * heißt `null` — dann nimmt der Aufrufer den Parser mit `fallback: true`.
 *
 * Wirft ein Parser beim Erkennen, zählt er als kein Treffer. Ein fehlerhafter
 * Parser darf die übrigen nicht blockieren.
 */
export function selectParser(parsers: readonly DocumentParser[], pages: readonly PdfPage[]): ParserMatch | null {
  let best: ParserMatch | null = null;
  for (const parser of parsers) {
    if (parser.fallback) continue;
    let confidence = 0;
    try {
      confidence = parser.detect(pages);
    } catch {
      continue;
    }
    if (confidence >= DETECT_THRESHOLD && (!best || confidence > best.confidence)) best = { parser, confidence };
  }
  return best;
}
