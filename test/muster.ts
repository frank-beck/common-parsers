import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PdfPage } from '../src/core/pdf-text.js';
import { seitenAusText } from '../scripts/seiten.mjs';

/** Erfundener Beleg aus test/fixtures, Format wie `npm run lesen` es schreibt. */
export function musterPages(file: string): PdfPage[] {
  return seitenAusText(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', file), 'utf8'));
}
