#!/usr/bin/env tsx
import { rotateCredentialKeys } from '../src/modules/token/service.js';
import { activeTotpKeyId, totpKeyring } from '../src/lib/totp.js';
import { sql } from '../src/db/index.js';

const toIndex = process.argv.indexOf('--to');
const target = toIndex >= 0 ? process.argv[toIndex + 1] : activeTotpKeyId();
if (!target) {
  console.error('Uso: npm run token:rotate-key -- --to <keyId>');
  process.exit(1);
}
if (!totpKeyring().keys.has(target)) {
  console.error(`La clave "${target}" no existe en TOTP_ENCRYPTION_KEYS`);
  process.exit(1);
}
if (target !== activeTotpKeyId()) {
  console.error(`TOTP_ACTIVE_KEY_ID debe ser "${target}" antes de rotar`);
  process.exit(1);
}

const updated = await rotateCredentialKeys(target);
console.log(`Credenciales re-cifradas con la clave "${target}": ${updated}`);
await sql.end({ timeout: 5 });
