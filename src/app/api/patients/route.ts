/**
 * GET /api/patients — List patients from the FHIR API.
 *
 * Returns a JSON array of patients with id, name, and dateOfBirth.
 * Enforces a 10-second timeout for FHIR requests.
 *
 * @see Requirements 3.1, 3.4
 */

import { NextResponse } from 'next/server';
import { createFHIRClient } from '@/lib/fhir-client';
import { validateConfig } from '@/lib/config';

export async function GET() {
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

  const result = await fhirClient.searchPatients();

  if (!result.success) {
    // Determine appropriate status code based on error message
    const isTimeout = result.error?.includes('timed out');
    const status = isTimeout ? 504 : 502;
    const code = isTimeout ? 'GATEWAY_TIMEOUT' : 'FHIR_ERROR';

    return NextResponse.json(
      { code, message: result.error ?? 'Failed to retrieve patients from FHIR API' },
      { status }
    );
  }

  // Format patient list with id, name, and dateOfBirth
  const patients = (result.data ?? []).map((patient) => {
    const nameEntry = patient.name?.[0];
    let displayName = 'Unknown';
    if (nameEntry?.text) {
      displayName = nameEntry.text;
    } else if (nameEntry?.given || nameEntry?.family) {
      const given = nameEntry.given?.join(' ') ?? '';
      const family = nameEntry.family ?? '';
      displayName = `${given} ${family}`.trim();
    }

    return {
      id: patient.id,
      name: displayName,
      dateOfBirth: patient.birthDate ?? null,
    };
  });

  return NextResponse.json(patients);
}
