#!/usr/bin/env ts-node
/**
 * Synthea data loading script for the Ambient Clinical Documentation Demo.
 *
 * Loads Synthea-generated FHIR R4 Bundle JSON files into OpenEMR via the FHIR API.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/load-synthea-data.ts <directory>
 *
 * Environment variables:
 *   OPENEMR_FHIR_BASE_URL  — Base URL of the OpenEMR FHIR API
 *   OPENEMR_CLIENT_ID      — OAuth2 client ID (or read from Secrets Manager)
 *   OPENEMR_CLIENT_SECRET  — OAuth2 client secret (or read from Secrets Manager)
 *   AWS_REGION             — AWS region for Secrets Manager (optional, defaults to us-east-1)
 *   OPENEMR_SECRET_NAME    — Secrets Manager secret name (optional)
 *
 * Exit codes:
 *   0 — All bundles loaded successfully (or some failed but processing completed)
 *   1 — FHIR API unreachable, missing arguments, or invalid directory
 *
 * @see Requirements 2.1, 2.2, 2.4, 2.6, 2.7
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoadResult {
  filename: string;
  success: boolean;
  error?: string;
}

export interface LoadSummary {
  total: number;
  successful: number;
  failed: number;
  results: LoadResult[];
}

export interface OAuth2Token {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface LoaderConfig {
  fhirBaseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Optional: custom fetch function for testing */
  fetchFn?: typeof fetch;
}

// ─── OAuth2 Authentication ───────────────────────────────────────────────────

/**
 * Obtains an OAuth2 access token using client credentials flow.
 */
export async function getAccessToken(config: LoaderConfig): Promise<string> {
  const fetchFn = config.fetchFn ?? fetch;
  const tokenUrl = `${config.fhirBaseUrl.replace(/\/fhir\/?$/, '')}/oauth2/default/token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'openid fhirUser system/Patient.write system/Condition.write system/MedicationRequest.write system/AllergyIntolerance.write system/Encounter.write system/Observation.write system/Procedure.write system/Immunization.write system/DiagnosticReport.write system/DocumentReference.write',
  });

  const response = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`OAuth2 token request failed: ${response.status} ${response.statusText}`);
  }

  const tokenResponse = (await response.json()) as OAuth2Token;
  return tokenResponse.access_token;
}

// ─── FHIR API Reachability Check ─────────────────────────────────────────────

/**
 * Checks FHIR API reachability by requesting the metadata endpoint.
 * Returns true if the API responds with a valid CapabilityStatement.
 *
 * @see Requirements 2.7
 */
export async function checkFhirReachability(config: LoaderConfig): Promise<boolean> {
  const fetchFn = config.fetchFn ?? fetch;
  const metadataUrl = `${config.fhirBaseUrl}/metadata`;

  try {
    const response = await fetchFn(metadataUrl, {
      method: 'GET',
      headers: { Accept: 'application/fhir+json' },
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { resourceType?: string };
    return data.resourceType === 'CapabilityStatement';
  } catch {
    return false;
  }
}

// ─── Bundle Loading ──────────────────────────────────────────────────────────

/**
 * Posts a single FHIR Bundle to the FHIR API.
 * Returns a LoadResult indicating success or failure with error details.
 *
 * @see Requirements 2.2, 2.4
 */
export async function loadBundle(
  filename: string,
  bundleContent: string,
  accessToken: string,
  config: LoaderConfig
): Promise<LoadResult> {
  const fetchFn = config.fetchFn ?? fetch;

  try {
    const response = await fetchFn(config.fhirBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: bundleContent,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        filename,
        success: false,
        error: `HTTP ${response.status}: ${errorBody.substring(0, 200)}`,
      };
    }

    return { filename, success: true };
  } catch (error) {
    return {
      filename,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─── Directory Processing ────────────────────────────────────────────────────

/**
 * Reads all .json files from the specified directory.
 */
export function getJsonFiles(directoryPath: string): string[] {
  const files = fs.readdirSync(directoryPath);
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(directoryPath, f));
}

/**
 * Loads all Synthea-generated FHIR R4 Bundles from a directory into OpenEMR.
 *
 * - Checks FHIR API reachability before processing
 * - Iterates all .json files in the directory
 * - POSTs each Bundle to the FHIR API
 * - Logs rejections with bundle filename, continues processing remaining records
 * - Returns a summary with total successful and failed counts
 *
 * @see Requirements 2.1, 2.2, 2.4, 2.6, 2.7
 */
export async function loadSyntheaData(
  directoryPath: string,
  config: LoaderConfig
): Promise<LoadSummary> {
  // Check FHIR API reachability
  const reachable = await checkFhirReachability(config);
  if (!reachable) {
    throw new Error(
      `FHIR API is unreachable at ${config.fhirBaseUrl}. ` +
      `Ensure the OpenEMR stack is deployed and the FHIR API endpoint is available.`
    );
  }

  // Get OAuth2 access token
  const accessToken = await getAccessToken(config);

  // Get all JSON files
  const jsonFiles = getJsonFiles(directoryPath);

  if (jsonFiles.length === 0) {
    return { total: 0, successful: 0, failed: 0, results: [] };
  }

  const results: LoadResult[] = [];

  for (const filePath of jsonFiles) {
    const filename = path.basename(filePath);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const result = await loadBundle(filename, content, accessToken, config);
      results.push(result);

      if (result.success) {
        console.log(`✓ Loaded: ${filename}`);
      } else {
        // Log rejection with bundle filename and continue (Requirement 2.4)
        console.error(`✗ Failed: ${filename} — ${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`✗ Failed: ${filename} — ${errorMessage}`);
      results.push({ filename, success: false, error: errorMessage });
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    total: results.length,
    successful,
    failed,
    results,
  };
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

/**
 * Prints the load summary to stdout.
 *
 * @see Requirements 2.6
 */
function printSummary(summary: LoadSummary): void {
  console.log('\n════════════════════════════════════════════');
  console.log('  Synthea Data Loading Summary');
  console.log('════════════════════════════════════════════');
  console.log(`  Total bundles processed: ${summary.total}`);
  console.log(`  Successful loads:        ${summary.successful}`);
  console.log(`  Failed loads:            ${summary.failed}`);
  console.log('════════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  // Parse command-line arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: load-synthea-data <directory>');
    console.error('  <directory>  Path to directory containing Synthea-generated FHIR R4 Bundle JSON files');
    process.exit(1);
  }

  const directoryArg = args[0];
  if (!directoryArg) {
    console.error('Usage: load-synthea-data <directory>');
    process.exit(1);
  }
  const directoryPath = path.resolve(directoryArg);

  // Validate directory exists
  if (!fs.existsSync(directoryPath)) {
    console.error(`Error: Directory not found: ${directoryPath}`);
    process.exit(1);
  }

  if (!fs.statSync(directoryPath).isDirectory()) {
    console.error(`Error: Path is not a directory: ${directoryPath}`);
    process.exit(1);
  }

  // Read configuration from environment
  const fhirBaseUrl = process.env['OPENEMR_FHIR_BASE_URL'];
  if (!fhirBaseUrl) {
    console.error('Error: OPENEMR_FHIR_BASE_URL environment variable is required');
    process.exit(1);
  }

  const clientId = process.env['OPENEMR_CLIENT_ID'];
  const clientSecret = process.env['OPENEMR_CLIENT_SECRET'];

  if (!clientId || !clientSecret) {
    console.error('Error: OPENEMR_CLIENT_ID and OPENEMR_CLIENT_SECRET environment variables are required');
    process.exit(1);
  }

  const config: LoaderConfig = {
    fhirBaseUrl: fhirBaseUrl.replace(/\/$/, ''),
    clientId,
    clientSecret,
  };

  console.log(`Loading Synthea data from: ${directoryPath}`);
  console.log(`FHIR API endpoint: ${config.fhirBaseUrl}`);
  console.log('');

  try {
    const summary = await loadSyntheaData(directoryPath, config);
    printSummary(summary);

    if (summary.failed > 0) {
      // Exit 0 even with failures — we logged them and continued (Requirement 2.4)
      process.exit(0);
    }
  } catch (error) {
    // FHIR API unreachable or other fatal error (Requirement 2.7)
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`\nFatal error: ${message}`);
    process.exit(1);
  }
}

// Only run main when executed directly (not when imported for testing)
if (require.main === module) {
  main();
}
