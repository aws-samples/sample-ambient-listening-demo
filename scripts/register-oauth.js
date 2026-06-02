// Register OAuth client in OpenEMR DB and update Secrets Manager
const{SecretsManagerClient,GetSecretValueCommand,UpdateSecretCommand}=require("@aws-sdk/client-secrets-manager");
const mysql=require("mysql2/promise");
const crypto=require("crypto");

async function main(){
  const sm=new SecretsManagerClient({region:"us-east-1"});
  
  // Get DB credentials
  const dbResp=await sm.send(new GetSecretValueCommand({SecretId:process.env.DB_SECRET_ARN||"arn:aws:secretsmanager:us-east-1:309117555342:secret:dbsecretF8F18970-r8AWnqKsdgNK-p9nmC6"}));
  const db=JSON.parse(dbResp.SecretString);
  
  const conn=await mysql.createConnection({host:db.host,port:db.port||3306,user:db.username,password:db.password,database:"openemr",ssl:{rejectUnauthorized:false}});
  
  // Generate credentials
  const clientId=crypto.randomBytes(32).toString("base64url");
  const clientSecret=crypto.randomBytes(48).toString("base64url");
  
  const scopes="openid api:oemr api:fhir user/Patient.read user/DocumentReference.read user/Encounter.read user/AllergyIntolerance.read user/Condition.read user/MedicationRequest.read user/encounter.read user/encounter.write user/soap_note.read user/soap_note.write";
  
  // Check if client exists
  const[existing]=await conn.execute("SELECT id FROM oauth_clients WHERE client_name='AmbientDocDemo'");
  
  if(existing.length>0){
    await conn.execute("UPDATE oauth_clients SET client_id=?,client_secret=?,scope=?,is_enabled=1,grant_types='password',is_confidential=1 WHERE client_name='AmbientDocDemo'",[clientId,clientSecret,scopes]);
    console.log("Updated existing OAuth client");
  }else{
    await conn.execute("INSERT INTO oauth_clients (client_id,client_secret,client_name,scope,grant_types,is_confidential,is_enabled,registration_date) VALUES(?,?,'AmbientDocDemo',?,'password',1,1,NOW())",[clientId,clientSecret,scopes]);
    console.log("Registered new OAuth client");
  }
  
  // Get admin password
  const adminResp=await sm.send(new GetSecretValueCommand({SecretId:process.env.OPENEMR_ADMIN_SECRET_ARN||"DemoAppStack/openemr-admin-credentials"}));
  const adminCreds=JSON.parse(adminResp.SecretString);
  
  // Update FHIR credentials secret
  const fhirSecretArn=process.env.FHIR_CREDENTIALS_SECRET_NAME||"DemoAppStack/fhir-api-credentials";
  const newSecret=JSON.stringify({clientId,clientSecret,username:"admin",password:adminCreds.password});
  await sm.send(new UpdateSecretCommand({SecretId:fhirSecretArn,SecretString:newSecret}));
  console.log("Updated FHIR credentials secret");
  console.log("Client ID:",clientId.substring(0,20)+"...");
  
  await conn.end();
}
main().catch(e=>{console.error("ERROR:",e.message);process.exit(1);});
