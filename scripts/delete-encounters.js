// Script to delete recent encounters for Margaret Smith
// Run via: node scripts/delete-encounters.js
// Requires DB_HOST and DB_PASSWORD env vars, or runs inside ECS with access

const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'openemr-cluster-x0l01f.cluster-cwvykmasge81.us-east-1.rds.amazonaws.com',
    port: 3306,
    user: 'admin',
    password: process.env.DB_PASSWORD || process.argv[2] || '',
    database: 'openemr',
    ssl: { rejectUnauthorized: false }
  });

  // Find Margaret Smith
  const [patients] = await conn.execute("SELECT pid, fname, lname FROM patient_data WHERE lname='Smith' AND fname='Margaret'");
  if (patients.length === 0) {
    console.log('Patient Margaret Smith not found');
    await conn.end();
    process.exit(0);
  }
  const pid = patients[0].pid;
  console.log('Patient:', patients[0].fname, patients[0].lname, 'PID=' + pid);

  // Find encounters from last 2 days
  const [encounters] = await conn.execute(
    'SELECT id, encounter, date, reason FROM form_encounter WHERE pid = ? AND date >= DATE_SUB(NOW(), INTERVAL 2 DAY) ORDER BY date DESC',
    [pid]
  );
  console.log('Encounters from last 2 days:', encounters.length);
  if (encounters.length === 0) {
    console.log('Nothing to delete');
    await conn.end();
    process.exit(0);
  }

  for (const e of encounters) {
    console.log('  Deleting encounter id=' + e.id + ' enc=' + e.encounter + ' date=' + e.date + ' reason=' + (e.reason || ''));
    const encNum = e.encounter;

    // Delete from form_clinical_notes
    const [r1] = await conn.execute('DELETE FROM form_clinical_notes WHERE encounter=? AND pid=?', [encNum, pid]);
    console.log('    form_clinical_notes: ' + r1.affectedRows + ' rows');

    // Delete from form_soap
    const [r2] = await conn.execute('DELETE FROM form_soap WHERE encounter=? AND pid=?', [encNum, pid]);
    console.log('    form_soap: ' + r2.affectedRows + ' rows');

    // Delete from forms table
    const [r3] = await conn.execute('DELETE FROM forms WHERE encounter=? AND pid=?', [encNum, pid]);
    console.log('    forms: ' + r3.affectedRows + ' rows');

    // Delete the encounter itself
    const [r4] = await conn.execute('DELETE FROM form_encounter WHERE id=?', [e.id]);
    console.log('    form_encounter: ' + r4.affectedRows + ' rows');
  }

  console.log('Done. Deleted ' + encounters.length + ' encounters.');
  await conn.end();
}

main().catch(function(e) { console.error('ERROR:', e.message); process.exit(1); });
