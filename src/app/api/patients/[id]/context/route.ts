/**
 * GET /api/patients/:id/context — Retrieve and format patient context.
 *
 * Retrieves patient demographics, conditions, medications, and allergies
 * from the FHIR API. Formats and truncates to 10KB using priority truncation.
 * Returns partial data with warnings if some resource types fail.
 * Returns 504 Gateway Timeout if FHIR API doesn't respond within 10 seconds.
 *
 * Response: { context: string, warnings?: string[] }
 *
 * @see Requirements 3.1, 3.3, 3.4, 3.5
 */

import { NextResponse } from 'next/server';
import { createFHIRClient } from '@/lib/fhir-client';
import { processPatientDataResult } from '@/lib/patient-context-formatter';
import { validateConfig } from '@/lib/config';
import { getEncounterNotesWithSummaries, getPatientPidFromUuid } from '@/lib/encounter-notes';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: patientId } = await params;

  const configResult = validateConfig();
  if (!configResult.valid) {
    return NextResponse.json(
      { code: 'CONFIG_ERROR', message: configResult.errors.join('; ') },
      { status: 500 }
    );
  }

  const { config } = configResult;
  const fhirClient = createFHIRClient({
    fhirBaseUrl: config.openemr.fhirBaseUrl,
    region: config.aws.region,
  });

  // Retrieve patient demographics first
  const patientResult = await fhirClient.getPatient(patientId);

  if (!patientResult.success) {
    const isTimeout = patientResult.error?.includes('timed out');
    if (isTimeout) {
      return NextResponse.json(
        { code: 'GATEWAY_TIMEOUT', message: 'FHIR API did not respond within 10 seconds' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { code: 'FHIR_ERROR', message: patientResult.error ?? 'Failed to retrieve patient' },
      { status: 502 }
    );
  }

  const patient = patientResult.data!;

  // Build demographics from FHIR Patient resource
  const nameEntry = patient.name?.[0];
  let displayName = 'Unknown';
  if (nameEntry?.text) {
    displayName = nameEntry.text;
  } else if (nameEntry?.given || nameEntry?.family) {
    const given = nameEntry.given?.join(' ') ?? '';
    const family = nameEntry.family ?? '';
    displayName = `${given} ${family}`.trim();
  }

  const birthDate = patient.birthDate ?? '';
  const age = birthDate ? calculateAge(birthDate) : 0;

  const demographics = {
    name: displayName,
    age,
    sex: patient.gender ?? 'Unknown',
    dateOfBirth: birthDate,
  };

  // Retrieve conditions, medications, allergies, and encounters (with partial failure handling)
  const [conditions, medications, allergies, encounters] = await Promise.all([
    fhirClient.getConditions(patientId),
    fhirClient.getMedications(patientId),
    fhirClient.getAllergies(patientId),
    fhirClient.getEncounters(patientId),
  ]);

  // Debug allergy field mapping verification removed — contained PHI

  // Attach clinical note summaries to encounters via direct DB query + Bedrock summarization
  let enrichedEncounters = encounters;
  if (encounters.success && encounters.data && encounters.data.length > 0) {
    try {
      const pid = await getPatientPidFromUuid(patientId);
      if (pid) {
        const notesWithSummaries = await getEncounterNotesWithSummaries(pid);
        console.log(`[PatientContext] Bedrock summarized ${notesWithSummaries.length} encounter notes`);

        if (notesWithSummaries.length > 0) {
          enrichedEncounters = {
            ...encounters,
            data: encounters.data.map((enc: any) => {
              const encDate = (enc.period?.start || enc.date || '').substring(0, 10);
              const matchingNote = notesWithSummaries.find(n => n.encounterDate === encDate);
              if (matchingNote && matchingNote.summary) {
                return { ...enc, _summary: matchingNote.summary };
              }
              return enc;
            }),
          };
        }
      } else {
        console.log(`[PatientContext] Could not resolve patient UUID to PID`);
      }
    } catch (err) {
      console.log(`[PatientContext] Encounter summary error: ${err instanceof Error ? err.name : 'Unknown error'}`);
    }
  }

  const dataResult = {
    patient: patientResult,
    conditions,
    medications,
    allergies,
    encounters: enrichedEncounters,
  };

  // Check if all resource types failed (patient succeeded but all others failed)
  const allResourcesFailed =
    !conditions.success && !medications.success && !allergies.success;

  if (allResourcesFailed) {
    // Check if it's a timeout issue
    const errors = [conditions.error, medications.error, allergies.error].filter(Boolean);
    const isTimeout = errors.some((e) => e?.includes('timed out'));
    if (isTimeout) {
      return NextResponse.json(
        { code: 'GATEWAY_TIMEOUT', message: 'FHIR API did not respond within 10 seconds' },
        { status: 504 }
      );
    }
  }

  // Process results with partial failure handling
  const displayResult = processPatientDataResult(dataResult, demographics);

  // Build response
  const response: { context: string; warnings?: string[] } = {
    context: displayResult.formattedContext,
  };

  if (displayResult.warning) {
    response.warnings = [displayResult.warning];
  }

  return NextResponse.json(response);
}

/**
 * Calculates age from a birth date string (YYYY-MM-DD format).
 */
function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}
