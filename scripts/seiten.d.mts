import type { PdfPage } from '../src/core/pdf-text.js';

export declare function seitenAlsText(pages: readonly PdfPage[]): string;
export declare function seitenAusText(text: string): PdfPage[];
