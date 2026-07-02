'use strict';

/**
 * Generate (or re-derive) the stable Chrome/Chromium extension key.
 *
 * Chrome derives an extension's ID from the SHA-256 of the public key's SPKI
 * DER encoding. By pinning a `key` in the MV3 manifest we get a deterministic
 * extension ID, which the native-messaging host manifest lists in
 * `allowed_origins` (chrome-extension://<id>/).
 *
 * Outputs:
 *   chrome-key.pem            RSA private key (GIT-IGNORED — keep secret/backed up)
 *   extension/chrome-key.json { key: <base64 SPKI DER>, extensionId: <id> }
 *
 * Usage:
 *   node scripts/gen-chrome-key.js          # derive JSON from existing PEM (default)
 *   node scripts/gen-chrome-key.js --force  # generate a NEW key pair (changes the ID!)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT      = path.resolve(__dirname, '..');
const PEM_PATH  = path.join(ROOT, 'chrome-key.pem');
const JSON_PATH = path.join(ROOT, 'extension', 'chrome-key.json');

const force = process.argv.includes('--force');

/** Chrome maps each nibble of the first 16 hash bytes to letters a–p. */
function chromeIdFromSpkiDer(der) {
  const hash = crypto.createHash('sha256').update(der).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0x0f));
  }
  return id;
}

function loadOrCreatePrivateKey() {
  if (fs.existsSync(PEM_PATH) && !force) {
    return crypto.createPrivateKey(fs.readFileSync(PEM_PATH, 'utf8'));
  }
  if (fs.existsSync(PEM_PATH) && force) {
    process.stdout.write('[gen-chrome-key] --force: overwriting existing chrome-key.pem (extension ID will change!)\n');
  }
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(PEM_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return privateKey;
}

function main() {
  const privateKey = loadOrCreatePrivateKey();
  const publicKey  = crypto.createPublicKey(privateKey);
  const der        = publicKey.export({ type: 'spki', format: 'der' });

  const key         = der.toString('base64');
  const extensionId = chromeIdFromSpkiDer(der);

  fs.writeFileSync(JSON_PATH, JSON.stringify({ key, extensionId }, null, 2) + '\n');

  process.stdout.write(`[gen-chrome-key] private key : ${path.relative(ROOT, PEM_PATH)} (git-ignored)\n`);
  process.stdout.write(`[gen-chrome-key] manifest key : ${path.relative(ROOT, JSON_PATH)}\n`);
  process.stdout.write(`[gen-chrome-key] extension ID : ${extensionId}\n`);
}

main();
