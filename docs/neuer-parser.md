# Neuer Parser — Schritt für Schritt

Für: ein Veranstalterbeleg, den NADIA noch nicht erkennt. Ziel: Parser live, ohne dass echte Kundendaten den eigenen Rechner verlassen. Stand 13.10.2026.

## Überblick

| # | Schritt | Befehl | Dauer (Schätzung) |
|---|---|---|---|
| 0 | Einmal einrichten | `npm ci` | 1 min |
| 1 | Echten Beleg lesen | `npm run lesen -- privat/beleg.pdf` | 2 min |
| 2 | Ersetzungsliste, automatisch | `npm run lesen -- privat/beleg.pdf --anonym` | 2 min |
| 3 | Muster prüfen — **Pflicht** | Namenssuche + Stellen mit Kundendaten | 10 min |
| 4 | Gerüst anlegen | `npm run neu -- <id> "<Veranstalter>"` | 1 min |
| 5 | Parser schreiben, bis Tests grün | mit KI erlaubt, nur am Muster | 10–30 min |
| 6 | Gegen echten Beleg prüfen | `npm run lesen -- privat/beleg.pdf` | 2 min |
| 7 | Prüfen, committen, pushen | `npm run pruefen` | 2 min |
| 8 | Release | `npm version minor …` | 1 min |
| 9 | In NADIA nachladen | Admin → *Belegparser* → *Jetzt nachladen* | 1 min |
| 10 | Aufräumen | `rm privat/…` | 1 min |

Ab Push bis live: Release-Lauf 17 s (gemessen 13.10.2026, v1.0.0), dann ein Klick. Ohne Klick spätestens nach 60 min.

## Datenschutz — zuerst lesen

**Dieses Repository ist öffentlich.** Was einmal gepusht ist, steht im Git-Verlauf und in jeder Kopie. Löschen und neu committen hilft nicht.

| Regel | Warum |
|---|---|
| Echte Belege nur in `privat/` | von git ausgeschlossen (`.gitignore`) |
| KI (Claude Code, ChatGPT, Copilot …) sieht **nur das geprüfte Muster** | was eine KI liest, geht an deren Server |
| `npm run lesen` **selbst** im Terminal starten, nicht von der KI | die Ausgabe enthält den echten Beleg |
| Keine Screenshots, kein Kopieren in Chats, Issues, Pull Requests | dito |
| Fertig → `privat/` leeren | Schritt 10 |

Schutz, der schon eingebaut ist — **kein Ersatz für Schritt 3**:

| Schutz | Was er tut | Was nicht |
|---|---|---|
| `.gitignore` | `privat/` und `*.pdf` außer `test/fixtures/*-muster.pdf` | `git add -f` umgeht ihn |
| Commit-Sperre `.githooks/pre-commit` | bricht den Commit ab bei: Angaben aus `privat/ersetzen.txt`, Belegdateien außerhalb `test/fixtures/*-muster.*`, E-Mails mit echter Domain, gültigen IBANs, Mobilnummern; unter `test/` Namen, Geburtsdaten, PLZ Ort, Telefon außerhalb des Pools | Namen ohne Anrede, Straßen ohne PLZ-Zeile, die **nicht** in `ersetzen.txt` stehen |
| `.claude/settings.json` | Claude Code darf `privat/` nicht lesen und `npm run lesen` nicht starten | andere KI-Werkzeuge kennen die Datei nicht |
| CI (`npm test`) | dieselbe Prüfung ohne `ersetzen.txt` | läuft erst **nach** dem Push |

### Erkennbare Testdaten — nur aus dem Pool

Alles Erfundene unter `test/` kommt aus einem festen Pool (`scripts/testdaten.mjs`). Wer es liest, sieht sofort: erfunden. Ein echter Wert fällt auf, weil er nicht im Pool steht. `--anonym` schreibt Pool-Werte.

| Art | Pool | Beispiel |
|---|---|---|
| Vornamen | Max, Erika, Moritz, Lisa, Paul, Mia, Tom, Lena, Ben, Anna, Peter | |
| Nachnamen | Mustermann, Musterfrau, Muster, Beispiel | `Max Mustermann`, `MUSTERFRAU/ERIKA` |
| Geburtsdatum | 01.01. + Jahr (Alter bleibt) | `01.01.2012` |
| Straße | Musterstraße + Nummer | `Musterstraße 1` |
| PLZ Ort | 12345 Musterstadt | `D - 12345 Musterstadt` |
| Telefon | nur Ziffern 0 und 1 | `+49 000 1111111` |
| E-Mail | `@example.com` (auch .org, .net, .test) | `kontakt1@example.com` |
| IBAN | Prüfziffer falsch | `DE00 1234 5678 9012 3456 78` |
| Buchungs-, Kunden-, Ticketnummer | Neunen, Länge bleibt | `999888777` |
| Reisebüro | Reisebüro Muster GmbH | |

Die Commit-Sperre prüft unter `test/`: Namen nach Herr/Frau/Kind und `NACHNAME/VORNAME`, Geburtsdaten, PLZ Ort, Telefon. Nicht aus dem Pool → Commit abgebrochen.

| Ausnahme | Wo |
|---|---|
| Anschrift, Hotline eines Veranstalters | `ERLAUBTE_ORTE`, `ERLAUBTE_TELEFONE` in `scripts/testdaten.mjs` |
| Platzhalter des Veranstalters (`Tba Tbab`) | erkannt, keine Eintragung nötig |
| Tests der Sperre selbst (brauchen echt aussehende Gegenbeispiele) | `NUR_GEGENBEISPIELE` |

Nicht geprüft: Namen ohne Anrede („1 Max Mustermann 30“ bei DERTOUR), Straßen ohne PLZ-Zeile, Reisedaten. Darum bleibt Schritt 3.

**Panne** (echte Angabe gepusht): sofort Frank. Nicht selbst „wegcommitten“ — der alte Stand bleibt abrufbar. Repository auf privat stellen, Verlauf bereinigen; ob gemeldet werden muss (DSGVO Art. 33, 72 h), entscheidet der Verantwortliche.

## 0. Einmal einrichten

```bash
cd ~/Development/dev-projects/common-parsers
npm ci                        # richtet auch die Commit-Sperre ein
git config core.hooksPath     # muss .githooks zeigen
```

Node ≥ 24 (`node -v`).

## 1. Echten Beleg lesen

```bash
mkdir -p privat
cp ~/Downloads/Buchungsbestaetigung.pdf privat/beleg.pdf
npm run lesen -- privat/beleg.pdf
```

Liest wie die App (pdfjs, gleiche Textaufbereitung). Ausgabe:

```
Text:   privat/beleg.txt  (echt, bleibt hier)
Erkennung (ab 0,80 sicher):
  0.00  tui-cruises
  0.85  tui-deutschland
→ tui-deutschland@1.0.0
Entwurf: …
```

| Ergebnis | Dann |
|---|---|
| ein Parser ≥ 0,80, Entwurf stimmt | nichts zu tun |
| ein Parser ≥ 0,80, Entwurf lückenhaft | bestehenden Parser verbessern: weiter ab Schritt 2, Schritt 4 entfällt |
| `→ generic … (Auffang)` | neuer Parser: alle Schritte |
| `Scan: … Zeichen Text` | Beleg ohne Textschicht. Text aus der App holen: lokal NADIA (`bin/dev` in nadia-ts) → *Neue Reise* → PDF → „Erkannter Text“ aufklappen → Seiten nach `privat/beleg.txt` kopieren, je Seite eine Zeile `=== Seite 1 ===` davor → `npm run lesen -- privat/beleg.txt`. Danach *Verwerfen* |

`privat/beleg.txt` zeigt genau den Text, den der Parser bekommt — mit allen Eigenheiten (Werte vor ihrer Beschriftung, zerrissene Zeilen). Danach richtet sich der Parser, nicht nach dem PDF-Bild.

## 2. Ersetzungsliste

**Automatisch:** `npm run lesen -- privat/beleg.pdf --anonym` schreibt Ersetzungen nach `privat/ersetzen.txt` und baut das Muster (`scripts/anonym.mjs`).

| Findet | Findet nicht |
|---|---|
| Namen und Geburtsdaten, die der Parser erkennt; Reisebüro aus dem Parser | Namen, die der Parser nicht erkennt — bei `generic` fast alle |
| E-Mail, IBAN, Telefon, Nummern ab 6 Ziffern, Anschriftblock (Straße / PLZ Ort je eigene Zeile) | Anschrift in einer Zeile, Name der Beratung, Nummern unter 6 Ziffern |

Danach trotzdem Schritt 3. Von Hand, je Zeile `echt = erfunden`:

```
# links: genau so, wie es im Beleg steht — rechts: aus dem Pool
# Personen — Vor- und Nachnamen einzeln, auch Mitreisende und Kinder
<Nachname> = Mustermann
<Vorname> = Max
<Vorname Kind> = Mia
# Anschrift
<Straße Nr> = Musterstraße 1
<PLZ Ort> = 12345 Musterstadt
# Nummern, Daten
<Buchungsnummer> = 999888777
<Geburtsdatum> = 01.01.<Jahr>
<IBAN> = DE00 1234 5678 9012 3456 78
<E-Mail> = kontakt1@example.com
<Telefon> = +49 000 1111111
```

```bash
npm run lesen -- privat/beleg.pdf
# Muster: privat/beleg.muster.txt  (9 Ersetzungen — jetzt lesen, Rest von Hand ersetzen)
#   ⚠ Zeile 41: Mobilnummer 0171 … — erfunden: +49 000 1111111
```

- Ersetzt ganze Wörter, Groß/klein egal; `SCHMIDT` wird `MUSTERFRAU`
- Längere Einträge zuerst: `Max Peter` vor `Max`
- Dieselbe Liste nutzt die Commit-Sperre. Darum alles eintragen, auch was du in Schritt 3 von Hand änderst

| Ersetzen | Darf bleiben |
|---|---|
| Namen aller Reisenden, Anschrift, Geburtsdaten | Name, Anschrift, Hotline des **Veranstalters** — braucht der Parser |
| Buchungs-, Vorgangs-, Kunden-, Ticketnummern | Hotel-, Schiffs-, Flughafennamen |
| Telefon, E-Mail, IBAN, Kartennummer der Kundschaft | Überschriften, Reihenfolge, Zeilenumbrüche |
| Reisedaten: Tage verschieben, Jahr auf 2027/2028 | Beträge (ruhig runden) |
| Name des Reisebüros und der Beratung | |

## 3. Muster prüfen — Pflicht

**Warum:** Das Muster kommt ins öffentliche Repository. Die Ersetzung findet nur, was in `ersetzen.txt` steht oder einem festen Muster folgt — der Rest bleibt echt. Gemessen 14.10.2026: nach `--anonym` standen im TUI-Muster noch Vorname und Geburtsdatum eines Kindes, die Kundenanschrift, Teile der Mobilnummer.

Drei Prüfungen, in dieser Reihenfolge:

**a) Namenssuche über die ganze Datei** — alle Vor- und Nachnamen, **auch Kinder**, dazu Straße und Ort:

```bash
grep -inE "Nachname|Vorname1|Vorname2|Kind1|Kind2|Straße|Wohnort" privat/beleg.muster.txt
```

Platzhalter durch die echten Werte ersetzen. Kein `#`-Kommentar dahinter (zsh liest ihn als Dateinamen). Ausgabe leer → weiter. Namen stehen auch außerhalb der Teilnehmerliste: Anrede, Freigepäck, Tickets (`NACHNAME/VORNAME`).

**b) Die Stellen mit Kundendaten Zeile für Zeile:**

| Veranstalter | Stellen |
|---|---|
| TUI Deutschland | Anrede Seite 1 · Teilnehmerliste „1 Herr …“ bis „5 Kind …“ · Block „Ihre Daten# Agentur oder Reisebüro#“ (Anschrift, Telefon, Mobil, E-Mail, Kunden-, Rechnungs-, Steuernummer) |
| DERTOUR | Kopf Seite 1 („Buchungsstelle“, Rechnungs-, Vorgangsnummer) · Anrede · „Anmelder/in“ und Reisendenliste · Freigepäck · Flug-/Airline-Buchungscode |
| Schauinsland | Reisebüro im Kopf (jede Seite) · „Reiseteilnehmer Alter“ (Geburtsdatum `TT.MM.JJ`) · „Kunde:“ und „Kundentelefonnummer“ (jede Seite) · Kennwort „mein-schauinsland“ · Lastschriftmandat (Name, Strasse, Ort, BIC, IBAN, Mandatsreferenz) · „AGENT.NR./KUND.NR.“ · Bankdaten der Vorabinformation · Vorstand im Sicherungsschein |
| neuer Veranstalter | Kopf, Anrede, Teilnehmerliste, Kontaktblock, jede Zeile mit Nummer; danach hier eintragen |

**c) Rest überfliegen:** Steht irgendwo noch ein Name, eine Nummer, ein Geburtsdatum?

Fund → in `ersetzen.txt` nachtragen, Schritt 2 wiederholen.

| Darf bleiben | Muss raus |
|---|---|
| Geschäftsführung, HRB, USt-ID, Anschrift, Hotline des **Veranstalters** | alles zu Kundschaft und Mitreisenden |
| Hotels, Flugnummern, Sitzplätze, Preise | Reisebüro: Name, Anschrift, Telefon, Steuernummer, Beratung |
| | Kennwörter und Zugangscodes (Kundenportal) |
| Platzhalter des Veranstalters („Tba“ bei DERTOUR) | Buchungs-, Rechnungs-, Kunden-, Ticketnummern |

Faustregel: Steht es so auf jedem Beleg des Veranstalters → bleibt. Betrifft es nur diese Buchung → raus.

Weiteres:

- Struktur **nicht** glätten: Zeilenumbrüche, doppelte Leerzeichen, verdrehte Reihenfolge sind genau das, was der Parser später sieht
- Lange Belege kürzen ist erlaubt: AGB-Seiten, Werbung raus; je Abschnittsart (Flug, Hotel, Zahlung) ein Beispiel behalten

Erst danach darf eine KI das Muster sehen.

## 4. Gerüst anlegen

```bash
npm run neu -- aida "AIDA Cruises"
```

- `id`: Kleinbuchstaben, Ziffern, Bindestrich; bleibt für immer (`aida`, `dertour-hotel`)
- Legt an: `src/parsers/aida.ts`, `test/aida.test.ts`, `test/fixtures/aida-muster.txt`; trägt in `src/parsers/index.ts` und `scripts/entries.mjs` ein
- Inhalt von `privat/beleg.muster.txt` nach `test/fixtures/aida-muster.txt` kopieren

`npm test` ist jetzt rot. Das ist richtig: die Tests beschreiben, was der Parser noch nicht kann.

## 5. Parser schreiben

**Mit KI** (Claude Code im Ordner common-parsers), Beispielauftrag:

> Implementiere src/parsers/aida.ts nach docs/vertrag.md, bis `npm test` grün ist. Beispieltext: test/fixtures/aida-muster.txt. Trage in test/aida.test.ts die erwarteten Werte aus dem Muster ein und ergänze Tests für Teilnehmer, Reiseplan und Zahlungen. Vorbild: src/parsers/tui-deutschland.ts.

**Von Hand:** Vorbild `src/parsers/tui-deutschland.ts`. Werkzeuge aus `src/core/text.ts`:

| Funktion | Wofür |
|---|---|
| `matchFirst(pages, /Muster (Gruppe)/)` | erster Treffer mit Fundstelle |
| `matchAll(pages, /…/g)` | alle Treffer, z. B. Flüge |
| `germanDate('15.01.2027')` | → `2027-01-15`, ungültig → `null` |
| `euroCents('1.234,50 €')` | → `123450` |
| `personName('MUSTERFRAU/ERIKA')` | → `Erika Musterfrau` |
| `shiftDate(date, 1, 'day')` | Nachtflug, Fristen |

Reihenfolge nach Nutzen: Vorgangsnummer, Reisezeitraum, Teilnehmer, Reiseplan, Zahlungen. Was fehlt, trägt die Beratung ein.

**Unsicher → `null` und eine Warnung.** Ein falsch geratenes Datum sieht richtig aus.

### Fallen

| Falle | Folge | Abhilfe |
|---|---|---|
| pdfjs liefert zweispaltige Köpfe in Zeichenreihenfolge | Wert steht **vor** seiner Beschriftung | Muster für beide Richtungen, siehe `tui-cruises.ts` „Ihr Schiff“ |
| Ligaturen zerlegt (`Hin` `fl` `ug`) | Wort fehlt im Text | `normalizeItems` klebt nach Abstand — nicht selbst Leerzeichen einsetzen |
| `\b` nur am ersten Begriff einer Alternation | „Rom“ trifft „La Romana“ | Alternativen gruppieren: `\b(?:A\|B)\b` |
| Zahlungsfrist als `travelerVisible: true` | Preise und Fristen in der Kundensicht | Zahlungen immer intern |
| Datum geraten | sieht richtig aus, ist falsch | `null` + Warnung; die Beratung trägt ein |
| `detect` ≥ 0,8 bei fremder Familie | falscher Parser gewinnt | Ausschluss wie `tui-deutschland` für „TUI Cruises“; Test „greift nicht bei fremden Belegen“ |
| Uhrzeit nach Mitternacht | Ankunft am falschen Tag | `endDate` um einen Tag schieben (Nachtflug) |
| `detect` nur auf Firmenname | Rechnung, Storno, Werbung desselben Veranstalters greifen | Firmenname **und** Belegart prüfen |

## 6. Gegen den echten Beleg prüfen

```bash
npm run lesen -- privat/beleg.pdf
# → aida@1.0.0
```

- Stimmen Vorgang, Zeitraum, Reisende, Reiseplan mit dem PDF überein?
- Abweichung → Muster in `test/fixtures/` um den fehlenden Fall ergänzen (erfunden!), Test schreiben, Parser anpassen
- Echte Werte nie in Tests übernehmen

Optional in der App: nadia-ts `bin/dev` baut die Parser aus diesem Ordner → *Neue Reise* → PDF. Danach *Verwerfen*.

## 7. Prüfen, committen, pushen

```bash
npm run pruefen               # Datenschutz, TypeScript, Tests
git add -A
git commit -m "feat: Parser für AIDA Cruises"
git push
```

Commit-Sperre meldet sich:

```
✗ Datenschutz: 1 Fund(e) — Commit abgebrochen
  test/fixtures/aida-muster.txt:8  „<Nachname>“ steht in privat/ersetzen.txt (echte Angabe)
  test/fixtures/aida-muster.txt:12  Name „<Vorname>“ nicht aus dem Pool — erfunden: Max Mustermann
```

→ Stelle ersetzen, `git add`, neu committen. Firmen-E-Mail eines Veranstalters → `ERLAUBTE_DOMAINS` in `scripts/datenschutz.mjs`.

Ohne Schreibrecht auf das Repository: Pull Request, Frank prüft und macht Schritt 8.

## 8. Release

```bash
npm version minor -m "release: %s"      # neuer Parser: 1.0.0 → 1.1.0
git push --follow-tags
```

- `patch` statt `minor` für Korrekturen an bestehenden Parsern
- Parser-Version in der Parserdatei: neuer Parser `1.0.0`; jede Änderung am Ergebnis eines bestehenden hebt **dessen** `version`
- GitHub → common-parsers → *Actions* → *Release* muss grün werden: prüft, testet, baut, signiert ([sicherheit.md](sicherheit.md))
- `npm version` verlangt einen sauberen Stand: vorher committen

## 9. In NADIA nachladen

Als Admin: *Belegparser* → *Jetzt nachladen*.

| Meldung | Bedeutung |
|---|---|
| `Release 1.1.0 aktiv: aida 1.0.0 neu.` | live |
| `Keine Änderung, 1.0.0 ist aktuell.` | Release-Lauf noch nicht fertig oder rot → *Actions* |
| `Nicht übernommen: … Aktiv bleibt 1.0.0.` | Signatur oder Hash falsch → Frank. Der alte Stand arbeitet weiter |

Ohne Klick: spätestens nach 60 min (`PARSERS_CACHE_SECONDS=3600`).

Probe: *Neue Reise* → echter Beleg → oben „AIDA Cruises — Buchungsbestätigung“, „Erkennung 95 %“. Nur Probe → *Verwerfen*.

Neu laden muss niemand: die App holt die Parserliste bei jedem Beleg.

## 10. Aufräumen

```bash
rm privat/beleg.*
rm privat/ersetzen.txt        # erst nach dem Push: bis dahin prüft die Commit-Sperre damit
```

## Wenn etwas schiefgeht

| Problem | Lösung |
|---|---|
| Neuer Parser liest live falsch | korrigieren, Parser-`version` heben, `npm version patch`, Push, *Jetzt nachladen* |
| Parser sofort zurückziehen | Eintrag aus `src/parsers/index.ts` und `scripts/entries.mjs` löschen, `npm version patch`, Push, *Jetzt nachladen*. Belege fallen auf den Auffangparser zurück |
| Release-Lauf rot | *Actions* → Lauf öffnen. Häufig: Test rot, oder Tag passt nicht zu `package.json` |
| `npm run neu`: „Liste nicht gefunden“ | `src/parsers/index.ts` von Hand: Import + Eintrag vor `genericParser` |
| Commit-Sperre fehlt (`git config core.hooksPath` leer) | `npm run prepare` |
| `npm test`: „lässt das Repository durch“ rot | dieselbe Prüfung wie die Commit-Sperre: `npm run datenschutz` zeigt die Stelle |

Weiter: [Vertrag](vertrag.md) · [Sicherheit und Release](sicherheit.md)
