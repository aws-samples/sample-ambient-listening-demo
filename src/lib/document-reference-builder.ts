/**
 * DocumentReference builder for clinical note write-back to OpenEMR.
 *
 * Builds a FHIR DocumentReference resource containing the clinical note
 * as a base64-encoded text attachment, with LOINC type coding for progress notes,
 * patient subject reference, and session date.
 *
 * @see Requirements 14.2
 */

import type { DocumentReferenceCreate } from '../types';

/**
 * Parameters for building a DocumentReference resource.
 */
export interface BuildDocumentReferenceParams {
  /** The clinical note content as plain text. */
  clinicalNoteContent: string;
  /** The patient ID (without the "Patient/" prefix). */
  patientId: string;
  /** The session date as a Date object or ISO 8601 string. */
  sessionDate: Date | string;
}

/**
 * Formats a date for display in the description field.
 * Returns the date in YYYY-MM-DD format (UTC).
 */
function formatDateForDescription(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a Date or ISO string to an ISO 8601 string.
 */
function toISOString(date: Date | string): string {
  if (typeof date === 'string') {
    return new Date(date).toISOString();
  }
  return date.toISOString();
}

/**
 * Base64-encodes a string (UTF-8).
 */
function encodeBase64(content: string): string {
  return Buffer.from(content, 'utf-8').toString('base64');
}

/**
 * Builds a FHIR DocumentReference resource for writing a clinical note
 * back to OpenEMR.
 *
 * The resource includes:
 * - A text/plain attachment with the clinical note content (base64-encoded)
 * - A subject reference to the associated patient (Patient/{patientId})
 * - The session date in ISO 8601 format
 * - LOINC type coding (11506-3 = Progress note)
 * - A description identifying it as an ambient clinical note
 *
 * @param params - The parameters for building the DocumentReference
 * @returns A complete DocumentReference resource ready to POST to the FHIR API
 */
export function buildDocumentReference(
  params: BuildDocumentReferenceParams
): DocumentReferenceCreate {
  const { clinicalNoteContent, patientId, sessionDate } = params;

  const isoDate = toISOString(sessionDate);
  const dateObj = typeof sessionDate === 'string' ? new Date(sessionDate) : sessionDate;
  const formattedDate = formatDateForDescription(dateObj);

  return {
    resourceType: 'DocumentReference',
    status: 'current',
    type: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '11506-3',
          display: 'Progress note',
        },
      ],
    },
    subject: { reference: `Patient/${patientId}` },
    date: isoDate,
    description: `Ambient Clinical Note - ${formattedDate}`,
    content: [
      {
        attachment: {
          contentType: 'text/plain',
          data: encodeBase64(clinicalNoteContent),
        },
      },
    ],
  };
}
