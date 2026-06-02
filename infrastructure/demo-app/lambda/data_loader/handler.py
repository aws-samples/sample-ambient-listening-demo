"""
Data Loader Lambda for the Ambient Clinical Documentation Demo.

Loads patient data into OpenEMR from Synthea-generated FHIR R4 bundles stored in S3.
Also ensures Margaret Smith (demo patient) exists and registers the OAuth2 client.

This Lambda is triggered:
1. As a CDK custom resource during deployment (skips if no S3 data yet)
2. Manually by deploy.sh after Synthea bundles are uploaded to S3

Synthea bundles contain: Patient, Condition, MedicationRequest, AllergyIntolerance,
Encounter, Observation, Procedure, Immunization, etc. We extract the relevant
resources and insert them into OpenEMR's database with proper form linkage.
"""

import json
import os
import boto3
import uuid
import random
from datetime import datetime

import pymysql
from pymysql import Error as MySQLError

# Configuration
DB_SECRET_ARN = os.environ.get('DB_SECRET_ARN')
SYNTHEA_BUCKET = os.environ.get('SYNTHEA_BUCKET', '')
SYNTHEA_PREFIX = os.environ.get('SYNTHEA_PREFIX', 'synthea-bundles/')
REGION = os.environ.get('AWS_REGION', 'us-east-1')

s3_client = boto3.client('s3', region_name=REGION)
secrets_client = boto3.client('secretsmanager', region_name=REGION)


def get_db_credentials():
    """Retrieve database credentials from Secrets Manager, with correct RDS endpoint."""
    db_secret_arn = os.environ.get('DB_SECRET_ARN', '')
    
    creds = None
    # Try configured ARN first, then discover by name pattern
    try:
        response = secrets_client.get_secret_value(SecretId=db_secret_arn)
        creds = json.loads(response['SecretString'])
    except Exception:
        print(f"  Configured DB_SECRET_ARN not found, discovering by name pattern...")
        paginator = secrets_client.get_paginator('list_secrets')
        for page in paginator.paginate(Filters=[{'Key': 'name', 'Values': ['dbsecretF8F18970']}]):
            for secret in page.get('SecretList', []):
                try:
                    response = secrets_client.get_secret_value(SecretId=secret['ARN'])
                    c = json.loads(response['SecretString'])
                    if 'password' in c:
                        creds = c
                        print(f"  Found DB secret: {secret['Name']}")
                        break
                except Exception:
                    continue
            if creds:
                break
    
    if not creds:
        raise Exception("Could not find OpenEMR database credentials in Secrets Manager")
    
    # Override host with actual RDS cluster endpoint (secret host may be stale)
    try:
        rds_client = boto3.client('rds', region_name=REGION)
        clusters = rds_client.describe_db_clusters()
        for cluster in clusters.get('DBClusters', []):
            if 'openemr' in cluster.get('DBClusterIdentifier', '').lower():
                actual_host = cluster['Endpoint']
                if actual_host != creds.get('host'):
                    print(f"  Overriding DB host: {creds.get('host')} -> {actual_host}")
                    creds['host'] = actual_host
                break
    except Exception as e:
        print(f"  Could not verify RDS endpoint: {e}")
    
    return creds


def get_db_connection(credentials):
    """Create database connection."""
    import ssl as ssl_module
    ssl_context = ssl_module.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl_module.CERT_NONE
    return pymysql.connect(
        host=str(credentials['host']),
        port=int(credentials.get('port', 3306)),
        user=str(credentials['username']),
        password=str(credentials['password']),
        database='openemr',
        connect_timeout=30,
        autocommit=False,
        ssl=ssl_context
    )


# ─── Margaret Smith (hardcoded demo patient) ──────────────────────────────────

MARGARET_SMITH = {
    'fname': 'Margaret',
    'lname': 'Smith',
    'dob': '1978-04-26',
    'sex': 'Female',
    'street': '181 Maple St',
    'city': 'Cambridge',
    'state': 'MA',
    'postal_code': '20610',
    'phone': '230-798-3109',
    'email': 'margaret.smith99@example.com',
    'pubpid': '5ddfb269',
    'conditions': [
        ('Chronic Obstructive Pulmonary Disease', 'J44.1'),
        ('Hypothyroidism', 'E03.9'),
    ],
    'allergies': [
        ('Bee stings', 'environment'),
        ('Ibuprofen', 'drug'),
        ('Aspirin', 'drug'),
    ],
    'medications': [
        ('Levothyroxine 50mcg', 'Take once daily on empty stomach'),
        ('Albuterol inhaler', 'Use as needed for shortness of breath'),
    ],
}


def load_margaret_smith(cursor):
    """Insert Margaret Smith as the guaranteed demo patient with encounters and notes."""
    # Check if she already exists
    cursor.execute("SELECT pid FROM patient_data WHERE fname='Margaret' AND lname='Smith'")
    existing = cursor.fetchone()
    if existing:
        print(f"Margaret Smith already exists (pid={existing[0]})")
        return existing[0]

    cursor.execute("SELECT COALESCE(MAX(pid), 1) + 1 FROM patient_data")
    patient_id = cursor.fetchone()[0]
    patient_uuid = uuid.uuid4().bytes
    p = MARGARET_SMITH

    cursor.execute("""
        INSERT INTO patient_data (pid, uuid, fname, lname, DOB, sex, street, city, state, postal_code, phone_home, email, pubpid, date)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    """, (patient_id, patient_uuid, p['fname'], p['lname'], p['dob'], p['sex'],
          p['street'], p['city'], p['state'], p['postal_code'], p['phone'], p['email'], p['pubpid']))

    for condition in p['conditions']:
        cursor.execute(
            "INSERT INTO lists (uuid, date, type, title, diagnosis, pid, begdate) VALUES (%s, NOW(), 'medical_problem', %s, %s, %s, %s)",
            (uuid.uuid4().bytes, condition[0], condition[1], patient_id, p['dob']))

    for allergy in p['allergies']:
        cursor.execute(
            "INSERT INTO lists (uuid, date, type, subtype, title, pid, begdate, outcome) VALUES (%s, NOW(), 'allergy', %s, %s, %s, NOW(), 1)",
            (uuid.uuid4().bytes, allergy[1], allergy[0], patient_id))

    for med in p['medications']:
        cursor.execute(
            "INSERT INTO lists (uuid, date, type, title, pid, begdate) VALUES (%s, NOW(), 'medication', %s, %s, NOW())",
            (uuid.uuid4().bytes, med[0], patient_id))

    # Create encounters with clinical notes for Margaret
    encounters_data = [
        ('2026-02-25', 'Annual checkup', """PROGRESS NOTE

Patient: Margaret Smith
DOB: 1978-04-26
Visit Type: Annual checkup

CHIEF COMPLAINT:
Annual wellness examination

HISTORY OF PRESENT ILLNESS:
Margaret presents for annual wellness examination. Reports feeling generally well.
COPD remains well-controlled on current inhaler regimen. Uses albuterol rescue inhaler
only 1-2 times per month. Thyroid symptoms stable on levothyroxine.

PAST MEDICAL HISTORY:
Chronic Obstructive Pulmonary Disease, Hypothyroidism

ALLERGIES:
Bee stings, Ibuprofen, Aspirin

CURRENT MEDICATIONS:
Levothyroxine 50mcg daily, Albuterol inhaler PRN

PHYSICAL EXAMINATION:
Vital Signs: BP 128/78, HR 72, RR 16, Temp 98.6F, SpO2 97% on RA
General: Alert and oriented, in no acute distress
Lungs: Clear to auscultation bilaterally, no wheezing
Cardiovascular: Regular rate and rhythm

ASSESSMENT AND PLAN:
1. COPD - Well controlled, continue current regimen
2. Hypothyroidism - Stable, continue levothyroxine 50mcg
3. Preventive care - Up to date on immunizations

Follow up in 6 months.

Electronically signed by: Dr. Demo Provider
"""),
        ('2025-11-07', 'Medication review', """PROGRESS NOTE

Patient: Margaret Smith
DOB: 1978-04-26
Visit Type: Medication review

CHIEF COMPLAINT:
Follow-up for COPD and thyroid medication review

HISTORY OF PRESENT ILLNESS:
Margaret presents for routine medication review. Reports occasional morning cough
but no increase in dyspnea. Denies chest pain or palpitations. Thyroid symptoms stable.

PAST MEDICAL HISTORY:
Chronic Obstructive Pulmonary Disease, Hypothyroidism

ALLERGIES:
Bee stings, Ibuprofen, Aspirin

CURRENT MEDICATIONS:
Levothyroxine 50mcg daily, Albuterol inhaler PRN

PHYSICAL EXAMINATION:
Vital Signs: BP 130/80, HR 70, RR 14, Temp 98.4F, SpO2 96% on RA
Lungs: Occasional scattered rhonchi, no wheezing

ASSESSMENT AND PLAN:
1. COPD - Consider adding tiotropium if symptoms increase
2. Hypothyroidism - Check TSH at next visit
3. Ordered: CBC, CMP, TSH, lipid panel

Follow up in 3 months.

Electronically signed by: Dr. Demo Provider
"""),
    ]

    for enc_date, reason, note_content in encounters_data:
        encounter_uuid = uuid.uuid4().bytes
        encounter_num = int(datetime.now().timestamp() * 1000) % 1000000000 + random.randint(1, 10000)

        cursor.execute(
            """INSERT INTO form_encounter (uuid, date, reason, pid, encounter, facility_id, pc_catid, class_code, sensitivity)
               VALUES (%s, %s, %s, %s, %s, 3, 5, 'AMB', 'normal')""",
            (encounter_uuid, enc_date, reason, patient_id, encounter_num))
        encounter_form_id = cursor.lastrowid

        cursor.execute(
            """INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, formdir, authorized, deleted)
               VALUES (%s, %s, 'New Patient Encounter', %s, %s, 'admin', 'Default', 'newpatient', 1, 0)""",
            (enc_date, encounter_num, encounter_form_id, patient_id))

        cursor.execute("SELECT COALESCE(MAX(form_id), 0) + 1 FROM form_clinical_notes")
        next_form_id = cursor.fetchone()[0]

        cursor.execute(
            """INSERT INTO form_clinical_notes
               (form_id, date, pid, encounter, user, groupname, authorized, activity, code, codetext, description, clinical_notes_type, note_related_to)
               VALUES (%s, %s, %s, %s, 'admin', 'Default', 1, 1, 'LOINC:34109-9', 'General Note', %s, 'progress_note', '[]')""",
            (next_form_id, enc_date, patient_id, str(encounter_num), note_content))

        cursor.execute(
            """INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, formdir, authorized, deleted)
               VALUES (%s, %s, 'Clinical Notes Form', %s, %s, 'admin', 'Default', 'clinical_notes', 1, 0)""",
            (enc_date, encounter_num, next_form_id, patient_id))

    print(f"Margaret Smith created (pid={patient_id}) with {len(encounters_data)} encounters")
    return patient_id


# ─── Synthea FHIR Bundle Parser ──────────────────────────────────────────────

def list_synthea_bundles(bucket, prefix):
    """List all JSON files in the Synthea S3 prefix."""
    keys = []
    paginator = s3_client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get('Contents', []):
            if obj['Key'].endswith('.json'):
                keys.append(obj['Key'])
    return keys


def read_bundle_from_s3(bucket, key):
    """Read and parse a FHIR bundle JSON from S3."""
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return json.loads(response['Body'].read().decode('utf-8'))


def extract_resources(bundle):
    """Extract resources from a Synthea FHIR bundle by type."""
    resources = {}
    for entry in bundle.get('entry', []):
        resource = entry.get('resource', {})
        rtype = resource.get('resourceType', '')
        if rtype not in resources:
            resources[rtype] = []
        resources[rtype].append(resource)
    return resources


def load_synthea_bundle(cursor, bundle):
    """
    Parse a Synthea FHIR bundle and insert patient data into OpenEMR.
    Returns the patient_id on success, None on failure.
    """
    resources = extract_resources(bundle)

    # Must have a Patient resource
    patients = resources.get('Patient', [])
    if not patients:
        return None
    patient_resource = patients[0]

    # Extract patient demographics
    name = patient_resource.get('name', [{}])[0]
    fname = ' '.join(name.get('given', ['Unknown']))
    lname = name.get('family', 'Unknown')

    # Skip if this is a duplicate Margaret Smith from Synthea
    if fname == 'Margaret' and lname == 'Smith':
        return None

    dob = patient_resource.get('birthDate', '1970-01-01')
    gender = patient_resource.get('gender', 'unknown')
    sex = 'Male' if gender == 'male' else 'Female'

    address = patient_resource.get('address', [{}])[0]
    street = ' '.join(address.get('line', ['']))
    city = address.get('city', '')
    state = address.get('state', '')
    postal_code = address.get('postalCode', '')

    telecom = patient_resource.get('telecom', [])
    phone = ''
    email = ''
    for t in telecom:
        if t.get('system') == 'phone':
            phone = t.get('value', '')
        elif t.get('system') == 'email':
            email = t.get('value', '')

    pubpid = patient_resource.get('id', str(uuid.uuid4())[:8])[:8]

    # Insert patient
    cursor.execute("SELECT COALESCE(MAX(pid), 1) + 1 FROM patient_data")
    patient_id = cursor.fetchone()[0]
    patient_uuid = uuid.uuid4().bytes

    cursor.execute("""
        INSERT INTO patient_data (pid, uuid, fname, lname, DOB, sex, street, city, state, postal_code, phone_home, email, pubpid, date)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    """, (patient_id, patient_uuid, fname, lname, dob, sex, street, city, state, postal_code, phone, email, pubpid))

    # Insert conditions (filter out social determinants, deduplicate)
    excluded_terms = ('finding', 'situation', 'person', 'education', 'employment', 'labor force', 'social', 'criminal')
    seen_conditions = set()
    for condition in resources.get('Condition', []):
        title = condition.get('code', {}).get('text', '')
        if not title:
            codings = condition.get('code', {}).get('coding', [])
            title = codings[0].get('display', 'Unknown') if codings else 'Unknown'
        
        # Skip social determinants and non-medical findings
        if any(term in title.lower() for term in excluded_terms):
            continue
        
        # Skip duplicates
        if title.lower() in seen_conditions:
            continue
        seen_conditions.add(title.lower())

        diagnosis = ''
        codings = condition.get('code', {}).get('coding', [])
        for c in codings:
            if c.get('system', '').endswith('icd10') or 'icd' in c.get('system', '').lower():
                diagnosis = c.get('code', '')
                break
            if c.get('system', '').endswith('snomed') or 'snomed' in c.get('system', '').lower():
                diagnosis = c.get('code', '')

        cursor.execute(
            "INSERT INTO lists (uuid, date, type, title, diagnosis, pid, begdate) VALUES (%s, NOW(), 'medical_problem', %s, %s, %s, %s)",
            (uuid.uuid4().bytes, title[:255], diagnosis[:255], patient_id, dob))

    # Insert allergies
    for allergy in resources.get('AllergyIntolerance', []):
        title = allergy.get('code', {}).get('text', '')
        if not title:
            codings = allergy.get('code', {}).get('coding', [])
            title = codings[0].get('display', 'Unknown') if codings else 'Unknown'
        categories = allergy.get('category', [])
        subtype = categories[0] if categories else 'drug'

        cursor.execute(
            "INSERT INTO lists (uuid, date, type, subtype, title, pid, begdate, outcome) VALUES (%s, NOW(), 'allergy', %s, %s, %s, NOW(), 1)",
            (uuid.uuid4().bytes, subtype[:255], title[:255], patient_id))

    # Insert medications (deduplicated, skip "Unknown", only active)
    seen_meds = set()
    for med in resources.get('MedicationRequest', []):
        title = med.get('medicationCodeableConcept', {}).get('text', '')
        if not title:
            codings = med.get('medicationCodeableConcept', {}).get('coding', [])
            title = codings[0].get('display', '') if codings else ''
        
        # Skip unknown, empty, or already-seen medications
        if not title or title == 'Unknown' or title.lower() in seen_meds:
            continue
        # Only active medications
        if med.get('status') not in ('active', 'completed'):
            continue
        
        seen_meds.add(title.lower())
        cursor.execute(
            "INSERT INTO lists (uuid, date, type, title, pid, begdate) VALUES (%s, NOW(), 'medication', %s, %s, NOW())",
            (uuid.uuid4().bytes, title[:255], patient_id))

    # Insert encounters with clinical notes
    encounters = resources.get('Encounter', [])
    # Limit to most recent 3 encounters
    encounters_sorted = sorted(encounters, key=lambda e: e.get('period', {}).get('start', ''), reverse=True)[:3]

    for enc in encounters_sorted:
        encounter_uuid = uuid.uuid4().bytes
        encounter_num = int(datetime.now().timestamp() * 1000) % 1000000000 + random.randint(1, 10000)

        # Get encounter date
        period = enc.get('period', {})
        enc_date = period.get('start', datetime.now().isoformat())[:10]

        # Get reason
        reason_codes = enc.get('reasonCode', enc.get('reason', []))
        if isinstance(reason_codes, list) and reason_codes:
            reason = reason_codes[0].get('text', '') or reason_codes[0].get('coding', [{}])[0].get('display', 'Office visit')
        else:
            reason = enc.get('type', [{}])[0].get('text', 'Office visit') if enc.get('type') else 'Office visit'

        # Insert encounter
        cursor.execute(
            """INSERT INTO form_encounter (uuid, date, reason, pid, encounter, facility_id, pc_catid, class_code, sensitivity)
               VALUES (%s, %s, %s, %s, %s, 3, 5, 'AMB', 'normal')""",
            (encounter_uuid, enc_date, reason[:255], patient_id, encounter_num))
        encounter_form_id = cursor.lastrowid

        # Register encounter in forms table
        cursor.execute(
            """INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, formdir, authorized, deleted)
               VALUES (%s, %s, 'New Patient Encounter', %s, %s, 'admin', 'Default', 'newpatient', 1, 0)""",
            (enc_date, encounter_num, encounter_form_id, patient_id))

        # Generate clinical note content from encounter context
        note_content = generate_note_from_encounter(enc, resources, fname, lname, dob, reason)

        # Get next form_id (the join key for form_clinical_notes)
        cursor.execute("SELECT COALESCE(MAX(form_id), 0) + 1 FROM form_clinical_notes")
        next_form_id = cursor.fetchone()[0]

        # Insert clinical note (matching OpenEMR UI pattern exactly)
        cursor.execute(
            """INSERT INTO form_clinical_notes
               (form_id, date, pid, encounter, user, groupname, authorized, activity, code, codetext, description, clinical_notes_type, note_related_to)
               VALUES (%s, %s, %s, %s, 'admin', 'Default', 1, 1, 'LOINC:34109-9', 'General Note', %s, 'progress_note', '[]')""",
            (next_form_id, enc_date, patient_id, str(encounter_num), note_content))

        # Link clinical note in forms table (form_id references form_clinical_notes.form_id)
        cursor.execute(
            """INSERT INTO forms (date, encounter, form_name, form_id, pid, user, groupname, formdir, authorized, deleted)
               VALUES (%s, %s, 'Clinical Notes Form', %s, %s, 'admin', 'Default', 'clinical_notes', 1, 0)""",
            (enc_date, encounter_num, next_form_id, patient_id))

    return patient_id


def generate_note_from_encounter(encounter, resources, fname, lname, dob, reason):
    """Generate a clinical note from Synthea encounter data."""
    # Collect conditions active at time of encounter
    conditions = resources.get('Condition', [])
    condition_names = list(set(
        c.get('code', {}).get('text', '') or
        (c.get('code', {}).get('coding', [{}])[0].get('display', ''))
        for c in conditions[:5]
    ))

    # Collect active medications
    medications = resources.get('MedicationRequest', [])
    med_names = list(set(
        m.get('medicationCodeableConcept', {}).get('text', '') or
        (m.get('medicationCodeableConcept', {}).get('coding', [{}])[0].get('display', ''))
        for m in medications if m.get('status') in ('active', 'completed')
    ))[:5]

    # Collect allergies
    allergies = resources.get('AllergyIntolerance', [])
    allergy_names = list(set(
        a.get('code', {}).get('text', '') or
        (a.get('code', {}).get('coding', [{}])[0].get('display', ''))
        for a in allergies
    ))

    # Get observations from the encounter period
    observations = resources.get('Observation', [])
    vitals = []
    for obs in observations[:10]:
        code_text = obs.get('code', {}).get('text', '')
        value = obs.get('valueQuantity', {})
        if value and code_text:
            vitals.append(f"{code_text}: {value.get('value', '')} {value.get('unit', '')}")

    conditions_text = ', '.join(filter(None, condition_names)) or 'None documented'
    meds_text = ', '.join(filter(None, med_names)) or 'None'
    allergies_text = ', '.join(filter(None, allergy_names)) or 'NKDA'
    vitals_text = '\n'.join(vitals[:6]) if vitals else 'Vital signs within normal limits'

    note = f"""PROGRESS NOTE

Patient: {fname} {lname}
DOB: {dob}
Visit Type: {reason}

CHIEF COMPLAINT:
{reason}

HISTORY OF PRESENT ILLNESS:
{fname} presents for {reason.lower()}. Patient reports current health status.

PAST MEDICAL HISTORY:
{conditions_text}

ALLERGIES:
{allergies_text}

CURRENT MEDICATIONS:
{meds_text}

PHYSICAL EXAMINATION:
{vitals_text}

ASSESSMENT AND PLAN:
1. {condition_names[0] if condition_names else 'Health maintenance'} - Continue current management
2. Follow up as scheduled

Electronically signed by: Dr. Demo Provider
"""
    return note


# ─── OAuth Client Registration ────────────────────────────────────────────────

def register_oauth_client(cursor, connection):
    """Register and enable an OAuth2 client in OpenEMR via direct DB insert.
    
    Also enables the password grant type in OpenEMR globals (disabled by default in 8.1.0).
    """
    import secrets as sec

    # Step 1: Enable password grant in OpenEMR globals
    cursor.execute("INSERT INTO globals (gl_name, gl_value) VALUES ('oauth_password_grant', '1') ON DUPLICATE KEY UPDATE gl_value='1'")
    connection.commit()
    print("  Enabled oauth_password_grant in globals")

    # Step 2: Register the OAuth client
    client_id = sec.token_urlsafe(32)
    client_secret = sec.token_urlsafe(64)

    scopes = ' '.join([
        'openid', 'api:oemr', 'api:fhir',
        'user/Patient.read', 'user/DocumentReference.read', 'user/Encounter.read',
        'user/AllergyIntolerance.read', 'user/Condition.read', 'user/MedicationRequest.read',
        'user/encounter.read', 'user/encounter.write',
        'user/soap_note.read', 'user/soap_note.write',
    ])

    # grant_types must include 'password' for the password grant flow
    grant_types = 'authorization_code password client_credentials refresh_token'

    cursor.execute("SELECT client_id FROM oauth_clients WHERE client_name = 'AmbientDocDemo'")
    existing = cursor.fetchone()

    if existing:
        cursor.execute(
            """UPDATE oauth_clients SET client_id=%s, client_secret=%s, scope=%s,
               is_enabled=1, grant_types=%s, is_confidential=1, redirect_uri='https://localhost/callback'
               WHERE client_name='AmbientDocDemo'""",
            (client_id, client_secret, scopes, grant_types))
        print("  Updated existing OAuth client 'AmbientDocDemo'")
    else:
        cursor.execute(
            """INSERT INTO oauth_clients (client_id, client_secret, client_name, scope, grant_types,
               is_confidential, is_enabled, register_date, redirect_uri)
               VALUES (%s, %s, 'AmbientDocDemo', %s, %s, 1, 1, NOW(), 'https://localhost/callback')""",
            (client_id, client_secret, scopes, grant_types))
        print("  Registered new OAuth client 'AmbientDocDemo'")

    connection.commit()

    # Step 3: Update FHIR credentials secret
    fhir_secret_arn = os.environ.get('FHIR_CREDENTIALS_SECRET_ARN', '')
    if fhir_secret_arn:
        # Get admin password
        admin_password = ''
        try:
            paginator = secrets_client.get_paginator('list_secrets')
            for page in paginator.paginate(Filters=[{'Key': 'name', 'Values': ['Password67973E0B']}]):
                for secret in page.get('SecretList', []):
                    resp = secrets_client.get_secret_value(SecretId=secret['ARN'])
                    creds = json.loads(resp['SecretString'])
                    admin_password = creds.get('password', '')
                    if admin_password:
                        break
                if admin_password:
                    break
        except Exception as e:
            print(f"  Could not read admin password: {e}")

        if admin_password:
            new_secret = json.dumps({
                'clientId': client_id,
                'clientSecret': client_secret,
                'username': 'admin',
                'password': admin_password,
            })
            secrets_client.update_secret(SecretId=fhir_secret_arn, SecretString=new_secret)
            print("  Updated FHIR credentials secret")
        else:
            print("  WARNING: No admin password found, secret not updated")


# ─── Main Handler ─────────────────────────────────────────────────────────────

def handler(event, context):
    """Lambda handler - loads Synthea data from S3 into OpenEMR."""
    request_type = event.get('RequestType', 'Create')
    print(f"Data loader invoked: {request_type}")

    if request_type == 'Delete':
        return send_response(event, context, 'SUCCESS', {'Message': 'Delete acknowledged'})

    # Get bucket/prefix from event properties or environment
    props = event.get('ResourceProperties', {})
    
    # Handle OAuth client enable request
    enable_client_id = props.get('EnableOAuthClient', '')
    if enable_client_id:
        try:
            credentials = get_db_credentials()
            conn = get_db_connection(credentials)
            cur = conn.cursor()
            # Enable password grant in OpenEMR globals
            cur.execute("INSERT INTO globals (gl_name, gl_value) VALUES ('oauth_password_grant', '1') ON DUPLICATE KEY UPDATE gl_value='1'")
            # Fix grant_types and enable the client
            cur.execute(
                "UPDATE oauth_clients SET is_enabled=1, grant_types='authorization_code password client_credentials refresh_token' WHERE client_name='AmbientDocDemo'")
            conn.commit()
            affected = cur.rowcount
            cur.close()
            conn.close()
            print(f"Enabled password grant in globals and fixed OAuth client (rows affected: {affected})")
            return send_response(event, context, 'SUCCESS', {'Message': f'OAuth client fixed ({affected} rows)'})
        except Exception as e:
            print(f"Failed to fix OAuth client: {e}")
            return send_response(event, context, 'FAILED', {'Message': str(e)})

    bucket = props.get('SyntheaBucket', SYNTHEA_BUCKET)
    prefix = props.get('SyntheaPrefix', SYNTHEA_PREFIX)
    force_reload = props.get('ForceReload', 'false') == 'true'

    if not bucket:
        print("No Synthea bucket configured, skipping data load")
        return send_response(event, context, 'SUCCESS', {'Message': 'No Synthea bucket - skipped'})

    try:
        credentials = get_db_credentials()
        connection = get_db_connection(credentials)
        cursor = connection.cursor()

        # Idempotency check
        cursor.execute("SELECT COUNT(*) FROM patient_data WHERE pubpid IS NOT NULL AND pubpid != ''")
        existing = cursor.fetchone()[0]
        if existing > 0 and not force_reload:
            print(f"Found {existing} existing patients. Skipping (use ForceReload=true to override).")
            cursor.close()
            connection.close()
            return send_response(event, context, 'SUCCESS', {
                'Message': f'Skipped - {existing} patients already exist',
                'PatientCount': str(existing)
            })

        # Force reload: clear existing data
        if force_reload and existing > 0:
            print(f"Force reload: clearing {existing} existing patients...")
            cursor.execute("DELETE FROM forms WHERE pid > 1")
            cursor.execute("DELETE FROM form_clinical_notes WHERE pid > 1")
            cursor.execute("DELETE FROM form_encounter WHERE pid > 1")
            cursor.execute("DELETE FROM form_soap WHERE pid > 1")
            cursor.execute("DELETE FROM immunizations WHERE patient_id > 1")
            cursor.execute("DELETE FROM lists WHERE pid > 1")
            cursor.execute("DELETE FROM patient_data WHERE pid > 1")
            connection.commit()
            print("Existing data cleared.")

        # Load Margaret Smith first (guaranteed demo patient)
        load_margaret_smith(cursor)
        connection.commit()

        # List Synthea bundles from S3
        print(f"Reading Synthea bundles from s3://{bucket}/{prefix}")
        bundle_keys = list_synthea_bundles(bucket, prefix)
        print(f"Found {len(bundle_keys)} Synthea bundles")

        if not bundle_keys:
            print("No Synthea bundles found in S3")
            cursor.close()
            connection.close()
            return send_response(event, context, 'SUCCESS', {
                'Message': 'No Synthea bundles found in S3',
                'PatientCount': '1'  # Margaret Smith
            })

        # Load each bundle
        loaded = 0
        errors = []
        for key in bundle_keys:
            try:
                bundle = read_bundle_from_s3(bucket, key)
                result = load_synthea_bundle(cursor, bundle)
                if result:
                    connection.commit()
                    loaded += 1
                else:
                    connection.rollback()
            except Exception as e:
                errors.append(f"{key}: {str(e)[:100]}")
                connection.rollback()

        print(f"Loaded {loaded}/{len(bundle_keys)} Synthea patients. Errors: {len(errors)}")
        if errors:
            print(f"First 5 errors: {errors[:5]}")

        cursor.close()
        connection.close()

        # Register OAuth client (new connection since cursor was closed)
        try:
            conn2 = get_db_connection(credentials)
            cur2 = conn2.cursor()
            register_oauth_client(cur2, conn2)
            cur2.close()
            conn2.close()
        except Exception as oauth_err:
            print(f"WARNING: OAuth client registration failed: {oauth_err}")

        return send_response(event, context, 'SUCCESS', {
            'Message': f'Loaded {loaded + 1} patients (including Margaret Smith)',
            'PatientCount': str(loaded + 1),
            'Errors': str(len(errors))
        })

    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return send_response(event, context, 'FAILED', {'Message': str(e)})


def send_response(event, context, status, data):
    """Send CloudFormation custom resource response."""
    import urllib.request

    response_body = json.dumps({
        'Status': status,
        'Reason': data.get('Message', ''),
        'PhysicalResourceId': context.log_stream_name if context else 'data-loader',
        'StackId': event.get('StackId', ''),
        'RequestId': event.get('RequestId', ''),
        'LogicalResourceId': event.get('LogicalResourceId', ''),
        'Data': data
    })

    response_url = event.get('ResponseURL')
    if response_url:
        req = urllib.request.Request(
            response_url,
            data=response_body.encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='PUT'
        )
        try:
            urllib.request.urlopen(req)
        except Exception as e:
            print(f"Failed to send CFN response: {e}")

    return data
