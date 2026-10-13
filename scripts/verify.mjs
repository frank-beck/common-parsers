// Prüft dist/ so, wie die App es tut: Signatur des Manifests, dann SHA-256
// jeder Datei.   node scripts/verify.mjs <PARSERS_PUBLIC_KEY>
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist');
const publicKeyBase64 = process.argv[2] ?? process.env.PARSERS_PUBLIC_KEY;
const manifestBytes = await readFile(join(dist, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
let failed = false;

if (publicKeyBase64) {
  // SPKI-Kopf für Ed25519 + 32 Byte Rohschlüssel.
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyBase64, 'base64')]);
  const signature = Buffer.from((await readFile(join(dist, 'manifest.json.sig'), 'utf8')).trim(), 'base64');
  const ok = verify(null, manifestBytes, createPublicKey({ key: der, format: 'der', type: 'spki' }), signature);
  console.log(`Signatur: ${ok ? 'gültig' : 'UNGÜLTIG'}`);
  failed ||= !ok;
} else {
  console.log('Signatur: nicht geprüft (kein öffentlicher Schlüssel angegeben)');
}

for (const entry of [manifest.runtime, ...manifest.parsers]) {
  const actual = createHash('sha256').update(await readFile(join(dist, entry.file))).digest('hex');
  const ok = actual === entry.sha256;
  console.log(`${ok ? 'ok  ' : 'FEHL'} ${entry.file}`);
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
