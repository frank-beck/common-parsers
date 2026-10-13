// Signiert dist/manifest.json (Ed25519, detached) nach dist/manifest.json.sig.
// Schlüssel aus PARSERS_SIGNING_KEY (PEM-Inhalt) oder PARSERS_SIGNING_KEY_FILE.
//
// Signiert werden die Bytes der Datei, nicht ein neu serialisiertes JSON.
// Wer das Manifest nach dem Signieren anfasst, macht die Signatur ungültig.
import { createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist');
const pem = process.env.PARSERS_SIGNING_KEY
  ?? (process.env.PARSERS_SIGNING_KEY_FILE ? await readFile(process.env.PARSERS_SIGNING_KEY_FILE, 'utf8') : null);
if (!pem) {
  console.error('PARSERS_SIGNING_KEY oder PARSERS_SIGNING_KEY_FILE fehlt.');
  process.exit(1);
}
const manifest = await readFile(join(dist, 'manifest.json'));
const signature = sign(null, manifest, createPrivateKey(pem));
await writeFile(join(dist, 'manifest.json.sig'), `${signature.toString('base64')}\n`);
console.log('dist/manifest.json.sig geschrieben');
