# Neuen Parser schreiben

## Schritte

1. Echten Beleg **lokal** in der App ansehen: Neue Reise → PDF wählen. Die Prüfansicht zeigt den erkannten Text je Seite. Den echten Beleg nie hier ablegen
2. Synthetischen Beleg bauen: Struktur und Formulierungen übernehmen, Namen/Nummern/Adressen erfinden (`Musterfrau`, `9999999/1`, `Testweg 1`)
3. `src/parsers/<id>.ts` anlegen, Vorbild `tui-deutschland.ts`
4. Eintragen in `src/parsers/index.ts` **und** `scripts/entries.mjs` — ein Test prüft, dass beide passen
5. Tests `test/<id>.test.ts` mit dem synthetischen Text
6. `npm run check && npm test && npm run build`
7. Lokal in der App gegen den echten Beleg prüfen (`PARSERS_SOURCE=../common-parsers/dist`)
8. `package.json`-Version heben, Tag `v<version>` → Release

## Fallen

| Falle | Folge | Abhilfe |
|---|---|---|
| pdfjs liefert zweispaltige Köpfe in Zeichenreihenfolge | Wert steht **vor** seiner Beschriftung | Muster für beide Richtungen, siehe `tui-cruises.ts` „Ihr Schiff“ |
| Ligaturen zerlegt (`Hin` `fl` `ug`) | Wort fehlt im Text | `normalizeItems` klebt nach Abstand — nicht selbst Leerzeichen einsetzen |
| `\b` nur am ersten Begriff einer Alternation | „Rom“ trifft „La Romana“ | Alternativen gruppieren: `\b(?:A\|B)\b` |
| Zahlungsfrist als `travelerVisible: true` | Preise und Fristen in der Kundensicht | Zahlungen immer intern |
| Datum geraten | sieht richtig aus, ist falsch | `null` + Warnung; die Beratung trägt ein |
| `detect` > 0,8 bei fremder Familie | falscher Parser gewinnt | Ausschluss wie `tui-deutschland` für „TUI Cruises“ |
| Uhrzeit nach Mitternacht | Ankunft am falschen Tag | `endDate` um einen Tag schieben (Nachtflug) |

## Versionen

- Neue Erkennung, geänderte Felder, andere Warnungen → `version` des Parsers heben
- Der Server lehnt Entwürfe mit `id@version` ab, die nicht im aktiven Manifest stehen. Ein offener Entwurf im Browser mit alter Version: Seite neu laden
