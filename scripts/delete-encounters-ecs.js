// Run inside ECS container: cd /app && node del.js
// Uses AWS SDK to get DB credentials from Secrets Manager
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const mysql = require('mysql2/promise');

async function main() {
  // Get DB credentials from Secrets Manager
  const sm = new SecretsManagerClient({ region: 'us-east-1' });
  const resp = await sm.send(new GetSecretValueCommand({ 
    SecretId: 'arn:aws:secretsmanager:us-east-1:309117555342:secret:dbsecretF8F18970-r8AWnqKsdgNK-p9nmC6' 
  }));
  const dbCreds = JSON.parse(resp.SecretString);
  
  const conn = await mysql.createConnection({
    host: dbCreds.host, port: dbCreds.port || 3306,
    user: dbCreds.username, password: dbCreds.password,
    database: 'openemr', ssl: { rejectUnauthorized: false }
  });

  // Find Margaret Smith
  const [patients] = await conn.execute("SELECT pid, fname, lname FROM patient_data WHERE lname='Smith' AND fname='Margaret'");
  if (patients.length === 0) { console.log('Patient not found'); await conn.end(); return; }
  const pid = patients[0].pid;
  console.log('Patient:', patients[0].fname, patients[0].lname, 'PID=' + pid);

  // Find encounters from last 2 days
  const [encounters] = await conn.execute(
    'SELECT id, encounter, date, reason FROM form_encounter WHERE pid = ? AND date >= DATE_SUB(NOW(), INTERVAL 2 DAY) ORDER BY date DESC', [pid]);
  console.log('Found', encounters.length, 'encounters from last 2 days');
  
  if (encounters.length === 0) { console.log('Nothing to delete'); await conn.end(); return; }

  for (const e of encounters) {
    console.log('Deleting enc=' + e.encounter + ' date=' + e.date + ' reason=' + (e.reason || ''));
    const enc = e.encounter;
    const formId = e.id;
    // Delete related forms by encounter number
    const [forms] = await conn.execute('SELECT id, formdir, form_id FROM forms WHERE encounter=? AND pid=?', [enc, pid]);
    for (const f of forms) {
      // Try to delete from the specific form table
      if (f.formdir === 'clinical_notes') {
        await conn.execute('DELETE FROM form_clinical_notes WHERE id=?', [f.form_id]).catch(function(){});
      } else if (f.formdir === 'soap') {
        await conn.execute('DELETE FROM form_soap WHERE id=?', [f.form_id]).catch(function(){});
      } else if (f.formdir === 'soap2') {
        await conn.execute('DELETE FROM form_soap2 WHERE id=?', [f.form_id]).catch(function(){});
      }
    }
    await conn.execute('DELETE FROM forms WHERE encounter=? AND pid=?', [enc, pid]);
    await conn.execute('DELETE FROM form_encounter WHERE id=?', [formId]);
    console.log('  deleted (' + forms.length + ' form entries)');
  }
  
  console.log('Done. Removed', encounters.length, 'encounters.');
  await conn.end();
}
main().catch(function(e) { console.error('ERROR:', e.message); process.exit(1); });
