// Feature: ambient-clinical-documentation-demo, Property 3: Data loading error continuity
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadSyntheaData,
  LoaderConfig,
  LoadSummary,
} from '../../../scripts/load-synthea-data';

/**
 * Property 3: Data loading error continuity
 *
 * For any batch of patient bundles where some are rejected by the FHIR API,
 * the loading script SHALL log each rejection with its bundle filename and
 * continue processing all remaining bundles in the batch.
 *
 * **Validates: Requirements 2.4**
 */
describe('Property 3: Data loading error continuity', () => {
  // ─── Test Helpers ────────────────────────────────────────────────────────

  function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'synthea-pbt-'));
  }

  function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
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

  /**
   * Creates a mock fetch function that simulates success/failure for each bundle POST
   * based on the provided outcome array. true = success, false = failure.
   */
  function createMockFetchWithOutcomes(outcomes: boolean[]): typeof fetch {
    let postCallCount = 0;

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();

      // Metadata endpoint — always reachable
      if (url.includes('/metadata')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ resourceType: 'CapabilityStatement' }),
          text: async () => JSON.stringify({ resourceType: 'CapabilityStatement' }),
          headers: new Headers(),
        } as Response;
      }

      // OAuth2 token endpoint — always succeeds
      if (url.includes('/oauth2/default/token')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ access_token: 'test-token', token_type: 'Bearer', expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: 'test-token' }),
          headers: new Headers(),
        } as Response;
      }

      // Bundle POST — use outcomes array to determine success/failure
      if (init?.method === 'POST') {
        const outcome = outcomes[postCallCount] ?? true;
        postCallCount++;

        if (outcome) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ resourceType: 'Bundle', type: 'transaction-response' }),
            text: async () => JSON.stringify({ resourceType: 'Bundle' }),
            headers: new Headers(),
          } as Response;
        } else {
          return {
            ok: false,
            status: 422,
            statusText: 'Unprocessable Entity',
            json: async () => ({ resourceType: 'OperationOutcome' }),
            text: async () => 'Validation error: invalid resource',
            headers: new Headers(),
          } as Response;
        }
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

  /**
   * Helper to set up a temp directory with bundle files and run loadSyntheaData.
   * Properly handles async cleanup after the promise resolves.
   */
  async function runWithOutcomes(outcomes: boolean[]): Promise<{ summary: LoadSummary; filenames: string[] }> {
    const tempDir = createTempDir();
    const filenames: string[] = [];

    try {
      for (let i = 0; i < outcomes.length; i++) {
        const filename = `patient-${String(i + 1).padStart(3, '0')}.json`;
        filenames.push(filename);
        createBundleFile(tempDir, filename);
      }

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: createMockFetchWithOutcomes(outcomes),
      };

      const summary = await loadSyntheaData(tempDir, config);
      return { summary, filenames };
    } finally {
      cleanupDir(tempDir);
    }
  }

  // ─── Arbitraries ─────────────────────────────────────────────────────────

  /**
   * Generates an array of boolean outcomes (true = success, false = failure)
   * with at least one failure and at least one success, length between 2 and 20.
   */
  const outcomesWithMixedResultsArb = fc
    .array(fc.boolean(), { minLength: 2, maxLength: 20 })
    .filter((outcomes) => outcomes.includes(true) && outcomes.includes(false));

  // ─── Property Tests ──────────────────────────────────────────────────────

  it('all bundles are attempted regardless of individual failures — results count equals input file count', async () => {
    await fc.assert(
      fc.asyncProperty(outcomesWithMixedResultsArb, async (outcomes) => {
        const { summary } = await runWithOutcomes(outcomes);
        // The total results count must equal the number of input files
        return summary.results.length === outcomes.length;
      }),
      { numRuns: 100 }
    );
  });

  it('the total field in summary equals the number of input files', async () => {
    await fc.assert(
      fc.asyncProperty(outcomesWithMixedResultsArb, async (outcomes) => {
        const { summary } = await runWithOutcomes(outcomes);
        return summary.total === outcomes.length;
      }),
      { numRuns: 100 }
    );
  });

  it('each failed result includes the filename of the failed bundle', async () => {
    await fc.assert(
      fc.asyncProperty(outcomesWithMixedResultsArb, async (outcomes) => {
        const { summary, filenames } = await runWithOutcomes(outcomes);
        const failedResults = summary.results.filter((r) => !r.success);

        // Every failed result must have a non-empty filename that matches one of the input files
        return failedResults.every(
          (r) => r.filename.length > 0 && filenames.includes(r.filename)
        );
      }),
      { numRuns: 100 }
    );
  });
});
