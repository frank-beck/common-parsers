/** Eine Seite des Belegs als Text. Seitenzahl ab 1, wie im PDF-Betrachter. */
export interface PdfPage {
  pageNumber: number;
  text: string;
}

/** Mehr Seiten liest die App nicht. Ein Beleg ist kein Katalog. */
export const MAX_PAGES = 40;

/** Weniger Zeichen ohne Leerraum: keine Textschicht, der Beleg ist eingescannt. */
export const MIN_TEXT_CHARS = 80;

/**
 * pdfjs liefert Textfragmente in Zeichenreihenfolge, nicht in Lesereihenfolge.
 * Bei zweispaltigen Veranstalterbelegen steht der Wert deshalb regelmäßig vor
 * seiner Beschriftung. Die Parser müssen beide Richtungen abdecken.
 *
 * Ob zwischen zwei Fragmenten ein Leerzeichen gehört, entscheidet allein ihr
 * Abstand. Ein pauschales Trennzeichen zerreißt zerlegte Ligaturen: TUI legt
 * `Hinflug` als `Hin` + `fl` + `ug` ab, jeweils ohne Lücke.
 *
 * Eingabe: `page.getTextContent().items` von pdfjs, unverändert.
 */
export function normalizeItems(items: readonly unknown[]): string {
  const GAP = 0.3;
  // Ein Rücksprung bedeutet eine neue Spalte derselben Zeile — dort gehört ein
  // Trennzeichen hin, auch wenn die Fragmente rechnerisch überlappen.
  const COLUMN_JUMP = -1;
  let text = '';
  let previousRight: number | null = null;
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('str' in item)) continue;
    const fragment = item as { str: unknown; hasEOL?: boolean; width?: number; transform?: number[] };
    if (typeof fragment.str !== 'string') continue;
    const left = Array.isArray(fragment.transform) ? fragment.transform[4] : null;
    if (previousRight !== null && typeof left === 'number' && !text.endsWith(' ')) {
      const gap = left - previousRight;
      if (gap > GAP || gap < COLUMN_JUMP) text += ' ';
    }
    text += fragment.str;
    previousRight =
      typeof left === 'number' && typeof fragment.width === 'number' ? left + fragment.width : null;
    if (fragment.hasEOL) {
      text += '\n';
      previousRight = null;
    }
  }
  return text.replaceAll(/[ \t]+\n/g, '\n').trimEnd();
}

export function joinedText(pages: readonly PdfPage[]): string {
  return pages.map((page) => page.text).join('\n');
}

/** Zeichen ohne Leerraum über alle Seiten. Unter `MIN_TEXT_CHARS`: Scan. */
export function textCharacters(pages: readonly PdfPage[]): number {
  return pages.reduce((total, page) => total + page.text.replace(/\s/g, '').length, 0);
}
