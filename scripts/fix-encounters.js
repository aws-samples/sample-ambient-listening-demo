// Fix encounters 13 and 14 - add missing forms entries and set pid
const{SecretsManagerClient,GetSecretValueCommand}=require("@aws-sdk/client-secrets-manager");
const mysql=require("mysql2/promise");

async function main(){
  const sm=new SecretsManagerClient({region:"us-east-1"});
  const r=await sm.send(new GetSecretValueCommand({SecretId:"arn:aws:secretsmanager:us-east-1:309117555342:secret:dbsecretF8F18970-r8AWnqKsdgNK-p9nmC6"}));
  const db=JSON.parse(r.SecretString);
  const c=await mysql.createConnection({host:db.host,port:db.port||3306,user:db.username,password:db.password,database:"openemr",ssl:{rejectUnauthorized:false}});

  const pid = 4; // Margaret Smith

  // Find the encounters created by the API
  const [encs] = await c.execute("SELECT id, encounter, date FROM form_encounter WHERE pid=? AND reason='Ambient Clinical Documentation Session' ORDER BY date DESC LIMIT 2", [pid]);
  console.log("Found encounters:", encs.length);

  if (encs.length === 0) {
    // The encounters might not have pid set either - check by date
    const [allEncs] = await c.execute("SELECT id, encounter, date, pid, reason FROM form_encounter WHERE reason='Ambient Clinical Documentation Session' ORDER BY date DESC LIMIT 5");
    console.log("All ambient encounters:", JSON.stringify(allEncs, null, 2));
  }

  // Fix SOAP notes - set pid=4
  const [upd1] = await c.execute("UPDATE form_soap SET pid=?, user='admin', authorized=1 WHERE id IN (13,14) AND pid=0", [pid]);
  console.log("Updated form_soap pid:", upd1.affectedRows, "rows");

  // Check form_encounter for these
  const [feCheck] = await c.execute("SELECT id, encounter, date, pid FROM form_encounter WHERE reason='Ambient Clinical Documentation Session' ORDER BY id DESC LIMIT 5");
  console.log("form_encounter entries:", JSON.stringify(feCheck, null, 2));

  // For each encounter, ensure forms table has entries
  for (const fe of feCheck) {
    if (!fe.encounter) {
      console.log("  Encounter id=" + fe.id + " has no encounter number, skipping");
      continue;
    }
    // Check if forms entry exists for the encounter form itself
    const [existingForms] = await c.execute("SELECT id, form_name FROM forms WHERE encounter=? AND pid=?", [fe.encounter, fe.pid || pid]);
    console.log("  Encounter " + fe.encounter + " has " + existingForms.length + " forms entries");
    
    if (existingForms.length === 0) {
      // Add the encounter form entry
      await c.execute(
        "INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, formdir) VALUES (?, ?, 'New Patient Encounter', ?, ?, 'admin', 'Default', 1, 'newpatient')",
        [fe.date, fe.encounter, fe.id, fe.pid || pid]
      );
      console.log("  Added newpatient form entry for encounter " + fe.encounter);
    }
  }

  // Now link SOAP notes to encounters via forms table
  // SOAP note id=13 -> encounter 13, SOAP note id=14 -> encounter 14
  const [soapNotes] = await c.execute("SELECT id, date FROM form_soap WHERE id IN (13,14)");
  for (const sn of soapNotes) {
    // Find the matching encounter by date proximity
    const [matchEnc] = await c.execute(
      "SELECT encounter FROM form_encounter WHERE pid=? AND reason='Ambient Clinical Documentation Session' ORDER BY ABS(TIMESTAMPDIFF(SECOND, date, ?)) LIMIT 1",
      [pid, sn.date]
    );
    if (matchEnc.length > 0 && matchEnc[0].encounter) {
      const enc = matchEnc[0].encounter;
      // Check if soap form entry already exists
      const [existing] = await c.execute("SELECT id FROM forms WHERE form_id=? AND formdir='soap'", [sn.id]);
      if (existing.length === 0) {
        await c.execute(
          "INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, authorized, formdir) VALUES (?, ?, 'SOAP', ?, ?, 'admin', 'Default', 1, 'soap')",
          [sn.date, enc, sn.id, pid]
        );
        console.log("  Linked SOAP note " + sn.id + " to encounter " + enc);
      } else {
        console.log("  SOAP note " + sn.id + " already linked");
      }
    }
  }

  console.log("Done");
  await c.end();
}
main().catch(e=>{console.error("ERROR:",e.message);process.exit(1);});
