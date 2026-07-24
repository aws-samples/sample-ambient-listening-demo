/**
 * POST /api/encounters/create — Create a new encounter with clinical note in OpenEMR.
 *
 * Accepts a patient FHIR UUID and SOAP sections, resolves the UUID to an OpenEMR PID,
 * then creates an encounter record with attached clinical note content.
 *
 * Returns 201 with { encounterId, createdAt } on success.
 * Returns 400 for validation errors, 404 if patient not found, 500 for database errors.
 *
 * @see Requirements 4.4, 4.5, 6.1, 6.2, 6.3, 6.5, 6.6
 */

import { NextResponse } from 'next/server';
import { createEncounterWithNote } from '@/lib/encounter-writeback';

interface CreateEncounterRequest {
  patientId: string;
  sections: {
    heading: string;
    content: string;
  }[];
  sessionId?: string;
}

export async function POST(request: Request) {
  // Parse request body
  let body: CreateEncounterRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      { status: 400 }
    );
  }

  // Validate patientId is present and non-empty
  if (!body.patientId || typeof body.patientId !== 'string' || body.patientId.trim() === '') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'patientId is required' },
      { status: 400 }
    );
  }

  // Validate sections array exists and has at least one non-empty section
  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'At least one SOAP section is required' },
      { status: 400 }
    );
  }

  const nonEmptySections = body.sections.filter(
    (s) => s && typeof s.heading === 'string' && typeof s.content === 'string' && s.content.trim() !== ''
  );

  if (nonEmptySections.length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'At least one SOAP section must have non-empty content' },
      { status: 400 }
    );
  }

  try {
    // Use the patient UUID directly with the FHIR API (no PID resolution needed)
    console.log(`[Encounters] Creating encounter via FHIR`);

    // Create encounter with clinical note via FHIR API
    const result = await createEncounterWithNote(body.patientId, nonEmptySections);

    console.log(`[Encounters] Success: encounterId=${result.encounterId}`);

    return NextResponse.json(
      {
        encounterId: result.encounterId,
        createdAt: result.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[Encounters] Encounter creation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Unable to process request. Please try again.' },
      { status: 500 }
    );
  }
}
