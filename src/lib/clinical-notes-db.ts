/**
 * Direct database query for clinical notes from OpenEMR.
 * 
 * OpenEMR stores clinical notes in form_clinical_notes and form_soap tables,
 * but doesn't expose them via the FHIR API. This module queries the database
 * directly to retrieve encounter summaries.
 */

import mysql from 'mysql2/promise';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

interface DbCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  dbname: string;
}

interface EncounterNote {
  encounterDate: string;
  reason: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

let cachedCredentials: DbCredentials | null = null;

/**
 * Retrieves database credentials from Secrets Manager.
 */
async function getDbCredentials(region: string): Promise<DbCredentials> {
  if (cachedCredentials) return cachedCredentials;

  const secretArn = process.env.DB_SECRET_ARN;
  if (!secretArn) throw new Error('DB_SECRET_ARN environment variable is not set');

  const client = new SecretsManagerClient({ region });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

  if (!response.SecretString) {
    throw new Error('DB secret has no string value');
  }

  const secret = JSON.parse(response.SecretString);
  cachedCredentials = {
    host: secret.host,
    port: secret.port || 3306,
    username: secret.username,
    password: secret.password,
    dbname: secret.dbname || 'openemr',
  };

  return cachedCredentials;
}

/**
 * Retrieves clinical notes for a patient's encounters from the OpenEMR database.
 * Queries form_clinical_notes and form_soap tables joined with form_encounter.
 * 
 * @param patientUuid - The patient's UUID (FHIR resource ID)
 * @param region - AWS region for Secrets Manager
 * @returns Array of encounter notes with assessment/plan summaries
 */
export async function getEncounterNotes(patientUuid: string, region: string): Promise<EncounterNote[]> {
  let connection: mysql.Connection | null = null;

  try {
    const creds = await getDbCredentials(region);
    connection = await mysql.createConnection({
      host: creds.host,
      port: creds.port,
      user: creds.username,
      password: creds.password,
      database: creds.dbname,
      connectTimeout: 5000,
      ssl: { rejectUnauthorized: true },
    });

    // First, get the patient's internal pid from their UUID
    const [pidRows] = await connection.execute<mysql.RowDataPacket[]>(
      'SELECT pid FROM patient_data WHERE uuid = UNHEX(REPLACE(?, "-", "")) LIMIT 1',
      [patientUuid]
    );

    if (!pidRows || pidRows.length === 0) {
      // Try without UUID format (some versions store differently)
      const [pidRows2] = await connection.execute<mysql.RowDataPacket[]>(
        'SELECT pid FROM patient_data WHERE uuid = ? LIMIT 1',
        [Buffer.from(patientUuid.replace(/-/g, ''), 'hex')]
      );
      if (!pidRows2 || pidRows2.length === 0) {
        console.log(`[ClinicalNotes] Patient not found by UUID`);
        return [];
      }
    }

    const pid = pidRows[0]?.pid;
    if (!pid) return [];

    // Query clinical notes (form_clinical_notes) joined with encounters
    const [noteRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT 
        fe.date as encounter_date,
        fe.reason,
        fcn.description as note_content,
        fcn.clinical_notes_type
      FROM form_encounter fe
      LEFT JOIN form_clinical_notes fcn ON fcn.encounter = fe.encounter AND fcn.pid = fe.pid
      WHERE fe.pid = ?
      ORDER BY fe.date DESC
      LIMIT 10`,
      [pid]
    );

    // Also check form_soap for SOAP notes
    const [soapRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT 
        fe.date as encounter_date,
        fe.reason,
        fs.subjective,
        fs.objective,
        fs.assessment,
        fs.plan
      FROM form_encounter fe
      LEFT JOIN form_soap fs ON fs.pid = fe.pid
      WHERE fe.pid = ?
      ORDER BY fe.date DESC
      LIMIT 10`,
      [pid]
    );

    const notes: EncounterNote[] = [];

    // Process clinical notes
    for (const row of noteRows) {
      if (row.note_content) {
        // Extract assessment from the note content
        const content = row.note_content as string;
        const assessmentMatch = content.match(/ASSESSMENT[:\s]*([\s\S]+?)(?=PLAN|$)/i);
        const planMatch = content.match(/PLAN[:\s]*([\s\S]+?)$/i);

        notes.push({
          encounterDate: row.encounter_date ? new Date(row.encounter_date).toISOString().substring(0, 10) : '',
          reason: (row.reason as string) || '',
          subjective: '',
          objective: '',
          assessment: assessmentMatch ? (assessmentMatch[1] || '').trim() : content.substring(0, 200),
          plan: planMatch ? (planMatch[1] || '').trim() : '',
        });
      }
    }

    // Process SOAP notes (if no clinical notes found)
    if (notes.length === 0) {
      for (const row of soapRows) {
        if (row.assessment || row.plan || row.subjective) {
          notes.push({
            encounterDate: row.encounter_date ? new Date(row.encounter_date).toISOString().substring(0, 10) : '',
            reason: (row.reason as string) || '',
            subjective: (row.subjective as string) || '',
            objective: (row.objective as string) || '',
            assessment: (row.assessment as string) || '',
            plan: (row.plan as string) || '',
          });
        }
      }
    }

    return notes;
  } catch (error) {
    console.error('[ClinicalNotes] DB query error:', error instanceof Error ? error.name : 'Unknown');
    return [];
  } finally {
    if (connection) {
      await connection.end().catch(() => {});
    }
  }
}
