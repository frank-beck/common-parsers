import type { TripImportDraft } from '../src/core/draft.js';
export declare function ersetzungen(draft: TripImportDraft, text: string): { echt: string; erfunden: string; art: string }[];
export declare function ersetze(text: string, paare: [string, string?][]): string;
