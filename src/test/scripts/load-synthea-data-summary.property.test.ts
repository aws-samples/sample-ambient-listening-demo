/**
 * Property-based test for data loading summary accuracy.
 *
 * Feature: ambient-clinical-documentation-demo, Property 4: Data loading summary accuracy
 *
 * Validates: Requirements 2.6
 *
 * For any batch of N patient bundle load attempts resulting in K failures,
 * the summary output SHALL report exactly (N - K) successful loads and exactly K failed loads.
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSyntheaData, LoaderConfig, LoadSummary } from '../../../scripts/load-synthea-data';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'synthea-pbt-summary-'));
}

function createBundleFile(dir: string, filename: string): void {
  const bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        resource: {
          resourceType: 'Patient',
          name: [{ family: 'Test', given: ['Patient'] }],
        },
        request: { method: 'POST', url: 'Patient' },
      },
    ],
  };
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(bundle));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Creates a mock fetch function that simulates a specific pattern of
 * successes and failures for bundle POST requests.
 *
 * @param failureIndices - Set of 0-based indices indicating which POSTs should fail
 */
function createMockFetchWithPattern(failureIndices: Set<number>): typeof fetch {
  let postCallCount = 0;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/metadata')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ resourceType: 'CapabilityStatement' }),
        text: async () => '{}',
        headers: new Headers(),
      } as Response;
    }

    if (url.includes('/oauth2/default/token')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ access_token: 'test-token', token_type: 'Bearer', expires_in: 3600 }),
        text: async () => '{}',
        headers: new Headers(),
      } as Response;
    }

    // POST to FHIR base (bundle upload)
    if (init?.method === 'POST' && !url.includes('token')) {
      const currentIndex = postCallCount;
      postCallCount++;

      if (failureIndices.has(currentIndex)) {
        return {
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          json: async () => ({ resourceType: 'OperationOutcome' }),
          text: async () => `Validation error for bundle at index ${currentIndex}`,
          headers: new Headers(),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ resourceType: 'Bundle', type: 'transaction-response' }),
        text: async () => '{}',
        headers: new Headers(),
      } as Response;
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
      text: async () => 'Not found',
      headers: new Headers(),
    } as Response;
  };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 4: Data loading summary accuracy', () => {
  /**
   * **Validates: Requirements 2.6**
   *
   * For any batch of N patient bundle load attempts with an arbitrary
   * success/failure pattern, the summary counts are always accurate:
   * - total === successful + failed
   * - successful count matches the number of results with success: true
   * - failed count matches the number of results with success: false
   */
  it('summary counts are always consistent with results for any success/failure pattern', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a total bundle count (1 to 20) and an array of booleans
        // indicating success (true) or failure (false) for each bundle
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        async (successPattern: boolean[]) => {
          const totalBundles = successPattern.length;
          const failureIndices = new Set<number>();

          successPattern.forEach((shouldSucceed, index) => {
            if (!shouldSucceed) {
              failureIndices.add(index);
            }
          });

          const expectedSuccessful = successPattern.filter((s) => s).length;
          const expectedFailed = successPattern.filter((s) => !s).length;

          // Create temp directory with the right number of bundle files
          const tempDir = createTempDir();
          try {
            for (let i = 0; i < totalBundles; i++) {
              createBundleFile(tempDir, `patient-${String(i).padStart(3, '0')}.json`);
            }

            const mockFetch = createMockFetchWithPattern(failureIndices);
            const config: LoaderConfig = {
              fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
              clientId: 'test-id',
              clientSecret: 'test-secret',
              fetchFn: mockFetch,
            };

            const summary: LoadSummary = await loadSyntheaData(tempDir, config);

            // Property: total === successful + failed
            expect(summary.total).toBe(summary.successful + summary.failed);

            // Property: total matches the number of bundles processed
            expect(summary.total).toBe(totalBundles);

            // Property: successful count matches expected
            expect(summary.successful).toBe(expectedSuccessful);

            // Property: failed count matches expected
            expect(summary.failed).toBe(expectedFailed);

            // Property: successful count matches results with success: true
            const actualSuccessCount = summary.results.filter((r) => r.success).length;
            expect(summary.successful).toBe(actualSuccessCount);

            // Property: failed count matches results with success: false
            const actualFailedCount = summary.results.filter((r) => !r.success).length;
            expect(summary.failed).toBe(actualFailedCount);

            // Property: results array length matches total
            expect(summary.results.length).toBe(summary.total);
          } finally {
            cleanupDir(tempDir);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * When all bundles succeed, the summary reports zero failures.
   */
  it('reports zero failures when all bundles succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 15 }),
        async (totalBundles: number) => {
          const tempDir = createTempDir();
          try {
            for (let i = 0; i < totalBundles; i++) {
              createBundleFile(tempDir, `patient-${String(i).padStart(3, '0')}.json`);
            }

            // No failures
            const mockFetch = createMockFetchWithPattern(new Set());
            const config: LoaderConfig = {
              fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
              clientId: 'test-id',
              clientSecret: 'test-secret',
              fetchFn: mockFetch,
            };

            const summary: LoadSummary = await loadSyntheaData(tempDir, config);

            expect(summary.total).toBe(totalBundles);
            expect(summary.successful).toBe(totalBundles);
            expect(summary.failed).toBe(0);
            expect(summary.total).toBe(summary.successful + summary.failed);
          } finally {
            cleanupDir(tempDir);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * When all bundles fail, the summary reports zero successes.
   */
  it('reports zero successes when all bundles fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 15 }),
        async (totalBundles: number) => {
          const tempDir = createTempDir();
          try {
            for (let i = 0; i < totalBundles; i++) {
              createBundleFile(tempDir, `patient-${String(i).padStart(3, '0')}.json`);
            }

            // All fail
            const allIndices = new Set(Array.from({ length: totalBundles }, (_, i) => i));
            const mockFetch = createMockFetchWithPattern(allIndices);
            const config: LoaderConfig = {
              fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
              clientId: 'test-id',
              clientSecret: 'test-secret',
              fetchFn: mockFetch,
            };

            const summary: LoadSummary = await loadSyntheaData(tempDir, config);

            expect(summary.total).toBe(totalBundles);
            expect(summary.successful).toBe(0);
            expect(summary.failed).toBe(totalBundles);
            expect(summary.total).toBe(summary.successful + summary.failed);
          } finally {
            cleanupDir(tempDir);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
