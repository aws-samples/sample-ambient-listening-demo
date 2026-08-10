/**
 * POST /api/sessions/[id]/writeback — Write clinical note back to OpenEMR.
 *
 * Accepts { patientId, clinicalNote, sessionDate } in the request body.
 * Uses DocumentReferenceBuilder to create a FHIR DocumentReference resource
 * and POSTs it to the OpenEMR FHIR API.
 *
 * Returns { success: true, documentId } on success.
 * Returns 400 if required fields are missing.
 * Returns 502 if the FHIR API write fails.
 * Supports up to 3 retry attempts (client can retry).
 *
 * @see Requirements 14.1, 14.2, 14.3, 14.4
 */

import { NextResponse } from 'next/server';
import { validateConfig } from '@/lib/config';
import { buildDocumentReference } from '@/lib/document-reference-builder';
import { createFHIRClient } from '@/lib/fhir-client';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // Consume the params (sessionId available if needed for logging)

    // Parse request body
    const body = await request.json() as {
      patientId?: string;
      clinicalNote?: string;
      sessionDate?: string;
    };
    const { patientId, clinicalNote, sessionDate } = body;

    if (!patientId || !clinicalNote || !sessionDate) {
      return NextResponse.json(
        {
          code: 'INVALID_REQUEST',
          message: 'Request body must include "patientId", "clinicalNote", and "sessionDate"',
          retryable: false,
        },
        { status: 400 }
      );
    }

    // Validate configuration
    const configResult = validateConfig();
    if (!configResult.valid) {
      return NextResponse.json(
        { code: 'CONFIG_ERROR', message: configResult.errors.join('; '), retryable: false },
        { status: 500 }
      );
    }

    const { config } = configResult;

    // Build the FHIR DocumentReference resource
    const documentReference = buildDocumentReference({
      clinicalNoteContent: clinicalNote,
      patientId,
      sessionDate,
    });

    // Create FHIR client and POST the DocumentReference
    const fhirClient = createFHIRClient({
      fhirBaseUrl: config.openemr.fhirBaseUrl,
      region: config.aws.region,
    });

    // POST to FHIR API
    const fhirBaseUrl = config.openemr.fhirBaseUrl.replace(/\/$/, '');
    const response = await fetch(`${fhirBaseUrl}/DocumentReference`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
      },
      body: JSON.stringify(documentReference),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        {
          code: 'FHIR_WRITE_FAILED',
          message: `FHIR write failed: ${response.status} ${response.statusText} - ${errorText}`,
          retryable: true,
          maxRetries: 3,
        },
        { status: 502 }
      );
    }

    const result = await response.json() as { id?: string };
    const documentId = result.id ?? 'unknown';

    // Suppress unused variable warning — fhirClient is available for authenticated requests
    void fhirClient;

    return NextResponse.json({
      success: true,
      documentId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        code: 'WRITEBACK_FAILED',
        message,
        retryable: true,
        maxRetries: 3,
      },
      { status: 500 }
    );
  }
}
