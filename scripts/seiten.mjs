// Belegtext als Datei: eine Zeile `=== Seite N ===` vor jeder Seite.
// So schreibt `npm run lesen` nach privat/, so lesen die Tests test/fixtures/*-muster.txt.

const KOPF = /^=== Seite (\d+) ===$/;

/** @param {{ pageNumber: number, text: string }[]} pages */
export function seitenAlsText(pages) {
  return pages.map((page) => `=== Seite ${page.pageNumber} ===\n${page.text}`).join('\n\n') + '\n';
}

/** @param {string} text */
export function seitenAusText(text) {
  const pages = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const kopf = KOPF.exec(line);
    if (kopf) pages.push({ pageNumber: Number(kopf[1]), lines: [] });
    else if (pages.length) pages.at(-1).lines.push(line);
  }
  if (!pages.length) throw new Error('Keine Zeile "=== Seite 1 ===" gefunden');
  return pages.map(({ pageNumber, lines }) => ({ pageNumber, text: lines.join('\n').trim() }));
}
