# common-parsers

Belegparser für Reiseunterlagen. PDF-Text rein, Reiseentwurf raus.

- Läuft **im Browser** der Reiseberatung, nicht auf dem Server
- Die App ([nadia-ts](../nadia-ts)) lädt die Module zur Laufzeit — neue Parser ohne App-Deploy
- Manifest ist Ed25519-signiert, jede Datei per SHA-256 festgenagelt

| Parser | Version | Erkennt |
|---|---|---|
| `tui-cruises` | 1.0.0 | TUI Cruises / Mein Schiff — Reisebestätigung / Rechnung |
| `tui-deutschland` | 1.0.0 | TUI Deutschland — Buchungsbestätigung / Rechnung |
| `generic` | 1.0.0 | Auffang: rät nichts, listet Daten, Beträge, Buchungsnummern |

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm ci` | Abhängigkeiten |
| `npm test` | Parser-, Text- und Build-Tests (vitest) |
| `npm run check` | TypeScript |
| `npm run build` | `dist/`: ein ES-Modul je Parser, `runtime-<v>.mjs`, `manifest.json` |
| `npm run sign` | `dist/manifest.json.sig`, Schlüssel aus `PARSERS_SIGNING_KEY(_FILE)` |
| `npm run verify -- <pubkey>` | Prüft dist/ wie die App: Signatur, dann Hashes |
| `npm run keygen -- <pfad.pem>` | Neues Schlüsselpaar; privat nie ins Repo |

## Lokal mit der App

```bash
npm ci && npm run build        # hier
# in nadia-ts/.env:
PARSERS_SOURCE=../common-parsers/dist
PARSERS_REQUIRE_SIGNATURE=false
```

Die App liest dann direkt aus diesem `dist/`. Nach jeder Änderung `npm run build` — die App merkt neue Hashes beim nächsten Abruf (lokal ohne Cache).

## Aufbau

```
src/core/       Vertrag (draft.ts), Textwerkzeuge, pdfjs-Aufbereitung, Auswahl
src/parsers/    ein Parser je Datei, Liste in index.ts
src/runtime.ts  was die App neben den Parsern braucht
scripts/        build, sign, verify, keygen; entries.mjs = was gebaut wird
test/           nur synthetische Belege (Musterfrau, Musterreisen GmbH)
```

## Regeln

- **Nur erfundene Testdaten.** Dieses Repository ist öffentlich. Echte Belege, Namen, Buchungsnummern gehören nirgendwo hierher — auch nicht im Git-Verlauf
- Parser sind reine Funktionen: kein `fetch`, kein `import()`, keine Node-APIs. `test/dist.test.ts` prüft das an den gebauten Modulen
- Jede Änderung am Ergebnis eines Parsers hebt dessen `version`
- Release nur über Tag `v<package.json-version>` → [release.yml](.github/workflows/release.yml)

Weiter: [Vertrag](docs/vertrag.md) · [Parser schreiben](docs/parser-schreiben.md) · [Sicherheit und Release](docs/sicherheit.md)

## Offen

- **Lizenz fehlt.** Vor dem Veröffentlichen festlegen (z. B. MIT), sonst darf rechtlich niemand den Code nutzen
