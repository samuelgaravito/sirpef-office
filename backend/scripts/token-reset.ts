#!/usr/bin/env tsx
import { resetTotpForEmail } from '../src/modules/token/service.js';
import { sql } from '../src/db/index.js';

const emailIndex = process.argv.indexOf('--email');
const email = emailIndex >= 0 ? process.argv[emailIndex + 1] : undefined;
if (!email) {
  console.error('Uso: npm run token:reset -- --email usuario@dominio');
  process.exit(1);
}

const result = await resetTotpForEmail(email);
console.log(
  `${result.deleted ? 'Token eliminado' : 'El usuario no tenía Token'}: ${result.user.email}`,
);
console.log('El usuario debe volver a vincular SirpefOffice Token desde la app de firma.');
await sql.end({ timeout: 5 });
