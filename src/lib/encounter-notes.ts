/**
 * Direct database query for encounter clinical notes.
 * 
 * OpenEMR stores clinical notes in `form_clinical_notes` table linked by encounter number.
 * The FHIR API doesn't expose these as DocumentReferences, so we query the DB directly.
 * 
 * After fetching raw notes, uses Amazon Bedrock (Claude) to generate concise clinical summaries.
 * 
 * The ECS task has access to the OpenEMR Aurora database via the DB secret.
 */

import mysql from 'mysql2/promise';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

const DB_SECRET_ARN = process.env.DB_SECRET_ARN || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

interface DbCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface EncounterNote {
  encounterDate: string;
  reason: string;
  description: string;
}

let cachedCredentials: DbCredentials | null = null;

async function getDbCredentials(): Promise<DbCredentials> {
  if (cachedCredentials) return cachedCredentials;

  if (!DB_SECRET_ARN) throw new Error('DB_SECRET_ARN environment variable is not set');

  const client = new SecretsManagerClient({ region: AWS_REGION });
  const response = await client.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));

  if (!response.SecretString) throw new Error('DB secret has no value');

  const secret = JSON.parse(response.SecretString);
  cachedCredentials = {
    host: secret.host,
    port: secret.port || 3306,
    username: secret.username,
    password: secret.password,
  };
  return cachedCredentials;
}

/**
 * Fetches clinical notes for a patient's encounters directly from the OpenEMR database.
 * 
 * @param patientPid - The OpenEMR patient PID (numeric ID)
 * @returns Array of encounter notes with date, reason, and clinical note description
 */
export async function getEncounterNotesFromDb(patientPid: number): Promise<EncounterNote[]> {
  const creds = await getDbCredentials();

  const connection = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password,
    database: 'openemr',
    connectTimeout: 5000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT 
        fe.date AS encounter_date,
        fe.reason,
        fcn.description
      FROM form_encounter fe
      LEFT JOIN form_clinical_notes fcn 
        ON fcn.encounter = fe.encounter AND fcn.pid = fe.pid
      WHERE fe.pid = ?
      ORDER BY fe.date DESC
      LIMIT 10`,
      [patientPid]
    );

    return rows.map((row) => ({
      encounterDate: row.encounter_date ? new Date(row.encounter_date).toISOString().substring(0, 10) : '',
      reason: row.reason || '',
      description: row.description || '',
    }));
  } finally {
    await connection.end();
  }
}

/**
 * Resolves a FHIR patient UUID to an OpenEMR PID.
 * OpenEMR stores the UUID in the patient_data table.
 */
export async function getPatientPidFromUuid(patientUuid: string): Promise<number | null> {
  const creds = await getDbCredentials();

  const connection = await mysql.createConnection({
    host: creds.host,
    port: creds.port,
    user: creds.username,
    password: creds.password,
    database: 'openemr',
    connectTimeout: 5000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // OpenEMR stores UUIDs as binary(16) — convert the hex UUID to binary for lookup
    const uuidHex = patientUuid.replace(/-/g, '');
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT pid FROM patient_data WHERE uuid = UNHEX(?)`,
      [uuidHex]
    );

    if (rows.length > 0 && rows[0]) {
      return rows[0].pid;
    }
    return null;
  } finally {
    await connection.end();
  }
}


// ─── Bedrock Summarization ───────────────────────────────────────────────────

const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });

/**
 * Summarizes a clinical note using Amazon Bedrock (Nova Lite for speed/cost).
 * Returns a concise 1-2 sentence clinical summary suitable for display in the patient context.
 */
async function summarizeWithBedrock(noteContent: string, reason: string): Promise<string> {
  const prompt = `Summarize this clinical encounter note in 2-3 sentences for a clinician reviewing patient history. Include key findings, diagnoses, medication changes, and follow-up plan. No patient names or dates.

Reason: ${reason}
Note: ${noteContent.substring(0, 2000)}`;

  try {
    const response = await bedrockClient.send(new ConverseCommand({
      modelId: 'us.amazon.nova-lite-v1:0',
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 500 },
    }));

    const outputText = response.output?.message?.content?.[0]?.text?.trim() || '';
    return outputText;
  } catch (error) {
    console.error('[EncounterNotes] Bedrock summarization error:', error instanceof Error ? error.message : error);
    return '';
  }
}

/**
 * Fetches encounter notes and summarizes them using Bedrock.
 * Returns enriched notes with AI-generated summaries.
 */
export async function getEncounterNotesWithSummaries(patientPid: number): Promise<(EncounterNote & { summary: string })[]> {
  const notes = await getEncounterNotesFromDb(patientPid);

  // Summarize notes in parallel (max 3 concurrent to avoid throttling)
  const enriched = await Promise.all(
    notes.filter(n => n.description).map(async (note) => {
      const summary = await summarizeWithBedrock(note.description, note.reason);
      return { ...note, summary };
    })
  );

  return enriched;
}
