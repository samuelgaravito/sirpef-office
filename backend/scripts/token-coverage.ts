#!/usr/bin/env tsx
import { listTotpCoverage } from '../src/modules/token/service.js';
import { sql } from '../src/db/index.js';

const rows = await listTotpCoverage();
const pending = rows.filter((row) => !row.paired);
console.log(`Administradores activos: ${rows.length}`);
console.log(`Con SirpefOffice Token:  ${rows.length - pending.length}`);
console.log(`Sin SirpefOffice Token:  ${pending.length}\n`);
for (const row of rows) {
  console.log(
    `${row.paired ? '✔' : '✖'} ${row.name} <${row.email}> ${row.paired ? `· ${row.pairedDeviceLabel || 'Token vinculado'}` : '· SIN TOKEN'}`,
  );
}
await sql.end({ timeout: 5 });
