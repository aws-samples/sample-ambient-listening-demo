/**
 * GET /api/health — Health check endpoint that verifies OpenEMR FHIR API connectivity.
 *
 * Performs a FHIR metadata request to verify the OpenEMR instance is reachable
 * and responding correctly. Returns connection status and FHIR version info.
 *
 * @see Requirements 10.3
 */

import { NextResponse } from 'next/server';
import { createFHIRClient } from '@/lib/fhir-client';
import { validateConfig } from '@/lib/config';

export interface HealthCheckResponse {
  status: 'connected' | 'disconnected';
  fhirVersion?: string;
  fhirStatus?: string;
  error?: string;
  timestamp: string;
}

export async function GET() {
  const timestamp = new Date().toISOString();

  const configResult = validateConfig();
  if (!configResult.valid) {
    const response: HealthCheckResponse = {
      status: 'disconnected',
      error: `Configuration error: ${configResult.errors.join('; ')}`,
      timestamp,
    };
    return NextResponse.json(response, { status: 503 });
  }

  const { config } = configResult;
  const fhirClient = createFHIRClient({
    fhirBaseUrl: config.openemr.fhirBaseUrl,
    region: config.aws.region,
  });

  const result = await fhirClient.getMetadata();

  if (!result.success) {
    const response: HealthCheckResponse = {
      status: 'disconnected',
      error: result.error ?? 'Failed to connect to FHIR API',
      timestamp,
    };
    return NextResponse.json(response, { status: 503 });
  }

  const response: HealthCheckResponse = {
    status: 'connected',
    fhirVersion: result.data?.fhirVersion,
    fhirStatus: result.data?.status,
    timestamp,
  };
  return NextResponse.json(response);
}
