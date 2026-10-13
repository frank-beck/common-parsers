// Erzeugt ein Ed25519-Schlüsselpaar für die Manifest-Signatur.
//   node scripts/keygen.mjs <pfad-privater-schluessel.pem>
// Der private Schlüssel gehört in kein Repository: GitHub-Secret
// PARSERS_SIGNING_KEY. Der öffentliche Schlüssel (Base64, 32 Byte) kommt in
// die App: PARSERS_PUBLIC_KEY.
import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const target = process.argv[2];
if (!target) {
  console.error('Pfad für den privaten Schlüssel fehlt: node scripts/keygen.mjs ~/parsers-signing.pem');
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
await writeFile(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
console.log(`Privater Schlüssel: ${target}`);
console.log(`PARSERS_PUBLIC_KEY=${raw.toString('base64')}`);
