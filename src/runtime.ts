/**
 * Was die App neben den Parsern braucht: Text aus pdfjs-Fragmenten bauen und
 * den passenden Parser wählen. Wird wie ein Parser als eigenes Modul
 * ausgeliefert, damit Textaufbereitung und Parser immer zusammenpassen.
 */
export { MAX_PAGES, MIN_TEXT_CHARS, joinedText, normalizeItems, textCharacters } from './core/pdf-text.js';
export type { PdfPage } from './core/pdf-text.js';
export { DETECT_THRESHOLD, selectParser } from './core/select.js';
export type { ParserMatch } from './core/select.js';
export { emptyDraft } from './core/draft.js';
export type * from './core/draft.js';
