# common-parsers

Belegparser für Reiseunterlagen. PDF-Text rein, Reiseentwurf raus.

**Neuen Parser bauen: [docs/neuer-parser.md](docs/neuer-parser.md)** — vom echten Beleg bis live, ohne Kundendaten im Repository.

- Läuft **im Browser** der Reiseberatung, nicht auf dem Server
- Die App ([nadia-ts](../nadia-ts)) lädt die Module zur Laufzeit — neue Parser ohne App-Deploy
- Manifest ist Ed25519-signiert, jede Datei per SHA-256 festgenagelt

| Parser | Version | Erkennt |
|---|---|---|
| `tui-cruises` | 1.0.0 | TUI Cruises / Mein Schiff — Reisebestätigung / Rechnung |
| `tui-deutschland` | 1.1.1 | TUI Deutschland — Buchungsbestätigung / Rechnung, auch Rundreisen |
| `dertour-angebot` | 1.0.0 | DERTOUR — Unverbindliches Angebot |
| `schauinsland` | 1.0.0 | Schauinsland-Reisen — Reisebestätigung/Rechnung |
| `generic` | 1.0.0 | Auffang: rät nichts, listet Daten, Beträge, Buchungsnummern |

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm ci` | Abhängigkeiten, richtet die Commit-Sperre ein (`.githooks`) |
| `npm run lesen -- privat/beleg.pdf` | echten Beleg lokal lesen: Text, Muster, welcher Parser greift |
| `npm run neu -- <id> "<Veranstalter>"` | Gerüst für einen neuen Parser |
| `npm run datenschutz` | sucht echte Kundendaten im Arbeitsverzeichnis |
| `npm run pruefen` | Datenschutz, TypeScript, Tests — vor jedem Push |
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
scripts/        build, sign, verify, keygen, lesen, anonym, neu, datenschutz, testdaten; entries.mjs = was gebaut wird
test/           nur erfundene Belege aus dem Pool (scripts/testdaten.mjs), test/fixtures/*-muster.*
privat/         echte Belege, nur lokal — von git ausgeschlossen
```

## Regeln

- **Nur erfundene Testdaten, erkennbar aus dem Pool** (Max Mustermann, Musterstraße 1, 12345 Musterstadt, +49 000 1111111). Dieses Repository ist öffentlich. Echte Belege, Namen, Buchungsnummern gehören nirgendwo hierher — auch nicht im Git-Verlauf. Echte Belege nur in `privat/`; Ablauf und Sperren: [neuer-parser.md](docs/neuer-parser.md#datenschutz--zuerst-lesen)
- Parser sind reine Funktionen: kein `fetch`, kein `import()`, keine Node-APIs. `test/dist.test.ts` prüft das an den gebauten Modulen
- Jede Änderung am Ergebnis eines Parsers hebt dessen `version`
- Release nur über Tag `v<package.json-version>` → [release.yml](.github/workflows/release.yml)

Weiter: [Neuer Parser](docs/neuer-parser.md) · [Vertrag](docs/vertrag.md) · [Sicherheit und Release](docs/sicherheit.md)

## Lizenz

MIT, siehe [LICENSE](LICENSE).
