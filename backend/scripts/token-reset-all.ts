#!/usr/bin/env tsx
import { db, sql } from '../src/db/index.js';
import {
  totpCredentials,
  totpDeviceChallenges,
  totpPairingCodes,
  totpRecoveryCodes,
} from '../src/db/schema.js';

if (!process.argv.includes('--apply')) {
  console.error('Esto borra todos los tokens TOTP. Ejecuta con --apply para confirmar.');
  process.exit(1);
}

await db.delete(totpCredentials);
await db.delete(totpPairingCodes);
await db.delete(totpRecoveryCodes);
await db.delete(totpDeviceChallenges);
console.log('Todos los tokens TOTP fueron eliminados. Los usuarios deben volver a vincular.');
await sql.end({ timeout: 5 });
