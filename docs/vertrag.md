# Vertrag zwischen App und Parser

Quelle der Wahrheit: [src/core/draft.ts](../src/core/draft.ts), [src/core/pdf-text.ts](../src/core/pdf-text.ts).

## Ablauf in der App

1. pdfjs liest die Textschicht, je Seite `normalizeItems(content.items)` aus der Runtime
2. Weniger als `MIN_TEXT_CHARS` (80) Zeichen ohne Leerraum → Scan → Texterkennung (tesseract.js, im Browser)
3. `selectParser(parser, seiten)`: höchste `detect()`-Wertung ab 0,8 gewinnt; kein Treffer → Parser mit `fallback: true`
4. `parse(seiten)` → `{ draft, warnings }`
5. App schickt PDF + `parserId` + `parserVersion` + Entwurf an den Server. Der Server nimmt nur `id@version` an, die im geprüften Manifest stehen

## Modul

```js
export default {
  id: 'tui-cruises',        // stabil, [a-z0-9-]
  version: '1.0.0',         // x.y.z
  family: 'TUI Cruises / Mein Schiff',
  label: 'TUI Cruises — Reisebestätigung / Rechnung',
  fallback: false,          // genau ein Parser: true
  detect(pages) { return 0..1 },
  parse(pages) { return { draft, warnings } }
}
```

- `pages`: `{ pageNumber: number, text: string }[]`, Seiten ab 1, höchstens 40
- `detect` darf werfen → zählt als 0
- `parse` muss für jede Eingabe einen Entwurf liefern; Unsicheres als `warnings`, nicht raten

## Entwurf (`TripImportDraft`)

| Feld | Format | Hinweis |
|---|---|---|
| `startsOn`, `endsOn`, `bookingDate` | `YYYY-MM-DD` oder `null` | lokales Datum, keine Zeitzone |
| `items[].date`, `endDate` | `YYYY-MM-DD` | |
| `items[].startTime`, `endTime` | `HH:MM` oder `null` | fehlt oft; App setzt Standardzeiten |
| `items[].kind` | `FLIGHT TRAIN TRANSFER HOTEL ACTIVITY MEAL NOTE` | |
| `tasks[].travelerVisible` | bool | `false` = interne Liste. **Zahlungsfristen immer `false`** |
| `tasks[].dueOn` | `YYYY-MM-DD` oder `null` | aus Regel berechnet; `rule` im Wortlaut |
| `payments[].amountCents` | Ganzzahl | `12.345,60 €` → `1234560` |
| `participants[].kind` | `PRIMARY COMPANION CHILD` | Erster = Hauptreisende |
| `destinationTimeZone` | IANA | Standard `Europe/Berlin` |
| `*.evidence` | `{ page, excerpt }` | Fundstelle für die Prüfansicht |

Der Server prüft Längen und Formate (siehe `nadia-ts`, `ImportDraftRules`). Was dort scheitert, sieht die Beratung als Fehlermeldung — der Parser ist dann zu korrigieren.
