# Sicherheit und Release

**Ein Parser ist fremder Code im Backoffice.** Er läuft im Browser der Beratung, mit deren Sitzung. Ein manipuliertes Modul könnte Reisedaten lesen und absenden. Deshalb:

| Schutz | Wo | Was es verhindert |
|---|---|---|
| Ed25519-Signatur über `manifest.json` | App-Server prüft mit `PARSERS_PUBLIC_KEY` | untergeschobenes Manifest (kompromittierter Download, falsches Release) |
| SHA-256 je Modul im Manifest | App-Server prüft vor dem Ausliefern | ausgetauschtes Modul bei gültigem Manifest |
| Auslieferung nur über die App (`/api/parsers/…`) | gleiche Herkunft, CSP `script-src 'self'` | Nachladen von Fremdservern |
| Keine Netz-APIs im Modul | `test/dist.test.ts` | Parser, der selbst etwas sendet |
| Parser-ID/Version serverseitig geprüft | `POST /api/backoffice/imports` | Entwurf aus nicht freigegebenem Parser |

**Was die Signatur nicht leistet:** Sie belegt nur, dass das Release mit unserem Schlüssel signiert wurde. Wer den privaten Schlüssel hat, kann beliebigen Code freigeben. Darum: Review vor jedem Tag, Schlüssel nur als GitHub-Secret, nie auf Entwicklerrechnern liegen lassen.

## Schlüssel

```bash
npm run keygen -- ~/parsers-signing.pem
# Ausgabe: PARSERS_PUBLIC_KEY=<base64>
```

- Privat: GitHub → common-parsers → Settings → Secrets → `PARSERS_SIGNING_KEY` (PEM-Inhalt). Danach Datei löschen
- Öffentlich: GitHub-Variable `PARSERS_PUBLIC_KEY` (für `verify` im Release) und in der App-`.env`
- Schlüsselwechsel: neues Paar, Secret ersetzen, neuen Public Key in die App **vor** dem nächsten Release

## Release

```bash
npm version 1.1.0 --no-git-tag-version
git commit -am "release: 1.1.0"
git tag v1.1.0 && git push --follow-tags
```

[release.yml](../.github/workflows/release.yml): prüft, testet, baut, signiert, verifiziert, legt Release mit allen `dist/`-Dateien an.

App-Quelle für „immer neuestes Release“:

```
PARSERS_SOURCE=https://github.com/frank-beck/common-parsers/releases/latest/download
```

Fest auf eine Version: `…/releases/download/v1.0.0`.

## Rückzug eines Parsers

Fehlerhaften Parser entfernen oder Version heben, neues Release. Die App übernimmt es nach `PARSERS_CACHE_SECONDS`. Sofort: in der App `php artisan parsers:refresh` bzw. Deploy-Endpunkt `parsers-refresh`.
