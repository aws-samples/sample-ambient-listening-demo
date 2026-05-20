/**
 * Tests for the Synthea data loading script.
 *
 * Uses mocked fetch to simulate FHIR API responses without requiring
 * a running OpenEMR instance.
 *
 * @see Requirements 2.1, 2.2, 2.4, 2.6, 2.7
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  checkFhirReachability,
  getAccessToken,
  loadBundle,
  getJsonFiles,
  loadSyntheaData,
  LoaderConfig,
} from '../../../scripts/load-synthea-data';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockFetch(responses: Map<string, { status: number; body: unknown }>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    // Match by URL pattern
    for (const [pattern, response] of responses) {
      if (url.includes(pattern)) {
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          statusText: response.status === 200 ? 'OK' : 'Error',
          json: async () => response.body,
          text: async () => JSON.stringify(response.body),
          headers: new Headers(),
        } as Response;
      }
    }

    // Default: 404
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'Not found' }),
      text: async () => 'Not found',
      headers: new Headers(),
    } as Response;
  };
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'synthea-test-'));
}

function createBundleFile(dir: string, filename: string, content?: object): void {
  const bundle = content ?? {
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('load-synthea-data', () => {
  describe('checkFhirReachability', () => {
    it('returns true when metadata endpoint returns CapabilityStatement', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['/metadata', { status: 200, body: { resourceType: 'CapabilityStatement', status: 'active' } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const result = await checkFhirReachability(config);
      expect(result).toBe(true);
    });

    it('returns false when metadata endpoint returns non-200', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['/metadata', { status: 503, body: { error: 'Service Unavailable' } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const result = await checkFhirReachability(config);
      expect(result).toBe(false);
    });

    it('returns false when metadata endpoint returns non-CapabilityStatement', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['/metadata', { status: 200, body: { resourceType: 'OperationOutcome' } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const result = await checkFhirReachability(config);
      expect(result).toBe(false);
    });

    it('returns false when fetch throws a network error', async () => {
      const mockFetch = async (): Promise<Response> => {
        throw new Error('ECONNREFUSED');
      };

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const result = await checkFhirReachability(config);
      expect(result).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('returns access token on successful OAuth2 request', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['/oauth2/default/token', { status: 200, body: { access_token: 'test-token-123', token_type: 'Bearer', expires_in: 3600 } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const token = await getAccessToken(config);
      expect(token).toBe('test-token-123');
    });

    it('throws error when OAuth2 request fails', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['/oauth2/default/token', { status: 401, body: { error: 'invalid_client' } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'bad-id',
        clientSecret: 'bad-secret',
        fetchFn: mockFetch,
      };

      await expect(getAccessToken(config)).rejects.toThrow('OAuth2 token request failed');
    });
  });

  describe('loadBundle', () => {
    it('returns success when FHIR API accepts the bundle', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['fhir', { status: 200, body: { resourceType: 'Bundle', type: 'transaction-response' } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const bundleContent = JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: [] });
      const result = await loadBundle('patient-001.json', bundleContent, 'token-123', config);

      expect(result.success).toBe(true);
      expect(result.filename).toBe('patient-001.json');
      expect(result.error).toBeUndefined();
    });

    it('returns failure with error details when FHIR API rejects the bundle', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['fhir', { status: 422, body: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', diagnostics: 'Invalid resource' }] } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const bundleContent = JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: [] });
      const result = await loadBundle('patient-bad.json', bundleContent, 'token-123', config);

      expect(result.success).toBe(false);
      expect(result.filename).toBe('patient-bad.json');
      expect(result.error).toContain('422');
    });

    it('returns failure when fetch throws a network error', async () => {
      const mockFetch = async (): Promise<Response> => {
        throw new Error('Connection reset');
      };

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const bundleContent = JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: [] });
      const result = await loadBundle('patient-net.json', bundleContent, 'token-123', config);

      expect(result.success).toBe(false);
      expect(result.filename).toBe('patient-net.json');
      expect(result.error).toBe('Connection reset');
    });
  });

  describe('getJsonFiles', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir();
    });

    afterEach(() => {
      cleanupDir(tempDir);
    });

    it('returns only .json files from the directory', () => {
      createBundleFile(tempDir, 'patient-001.json');
      createBundleFile(tempDir, 'patient-002.json');
      fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'not a json file');
      fs.writeFileSync(path.join(tempDir, 'notes.md'), '# notes');

      const files = getJsonFiles(tempDir);
      expect(files).toHaveLength(2);
      expect(files.every((f) => f.endsWith('.json'))).toBe(true);
    });

    it('returns empty array for directory with no .json files', () => {
      fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'no json here');

      const files = getJsonFiles(tempDir);
      expect(files).toHaveLength(0);
    });

    it('returns empty array for empty directory', () => {
      const files = getJsonFiles(tempDir);
      expect(files).toHaveLength(0);
    });
  });

  describe('loadSyntheaData', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir();
    });

    afterEach(() => {
      cleanupDir(tempDir);
    });

    it('throws error when FHIR API is unreachable', async () => {
      const mockFetch = async (): Promise<Response> => {
        throw new Error('ECONNREFUSED');
      };

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      createBundleFile(tempDir, 'patient-001.json');

      await expect(loadSyntheaData(tempDir, config)).rejects.toThrow(
        'FHIR API is unreachable'
      );
    });

    it('returns empty summary for directory with no JSON files', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['/metadata', { status: 200, body: { resourceType: 'CapabilityStatement' } }],
          ['/oauth2/default/token', { status: 200, body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const summary = await loadSyntheaData(tempDir, config);
      expect(summary.total).toBe(0);
      expect(summary.successful).toBe(0);
      expect(summary.failed).toBe(0);
    });

    it('loads all bundles successfully and reports correct summary', async () => {
      createBundleFile(tempDir, 'patient-001.json');
      createBundleFile(tempDir, 'patient-002.json');
      createBundleFile(tempDir, 'patient-003.json');

      const mockFetch = createMockFetch(
        new Map([
          ['/metadata', { status: 200, body: { resourceType: 'CapabilityStatement' } }],
          ['/oauth2/default/token', { status: 200, body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 } }],
          ['/fhir', { status: 200, body: { resourceType: 'Bundle', type: 'transaction-response' } }],
        ])
      );

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const summary = await loadSyntheaData(tempDir, config);
      expect(summary.total).toBe(3);
      expect(summary.successful).toBe(3);
      expect(summary.failed).toBe(0);
    });

    it('continues processing after rejection and reports correct summary', async () => {
      createBundleFile(tempDir, 'patient-001.json');
      createBundleFile(tempDir, 'patient-002.json');
      createBundleFile(tempDir, 'patient-003.json');

      // Track call count to simulate mixed success/failure
      let postCallCount = 0;
      const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
            json: async () => ({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 }),
            text: async () => '{}',
            headers: new Headers(),
          } as Response;
        }

        // POST to FHIR base — alternate success/failure
        if (init?.method === 'POST' && !url.includes('token')) {
          postCallCount++;
          if (postCallCount === 2) {
            // Second bundle fails
            return {
              ok: false,
              status: 422,
              statusText: 'Unprocessable Entity',
              json: async () => ({ resourceType: 'OperationOutcome' }),
              text: async () => 'Invalid resource',
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

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const summary = await loadSyntheaData(tempDir, config);

      // All 3 bundles should be processed (Requirement 2.4 — continue after rejection)
      expect(summary.total).toBe(3);
      expect(summary.successful).toBe(2);
      expect(summary.failed).toBe(1);

      // The failed result should include the filename (Requirement 2.4)
      const failedResult = summary.results.find((r) => !r.success);
      expect(failedResult).toBeDefined();
      expect(failedResult!.filename).toBeTruthy();
      expect(failedResult!.error).toBeTruthy();
    });

    it('summary counts match actual results (Requirement 2.6)', async () => {
      // Create 5 bundles
      for (let i = 1; i <= 5; i++) {
        createBundleFile(tempDir, `patient-${String(i).padStart(3, '0')}.json`);
      }

      // Fail bundles 2 and 4
      let postCallCount = 0;
      const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/metadata')) {
          return {
            ok: true, status: 200, statusText: 'OK',
            json: async () => ({ resourceType: 'CapabilityStatement' }),
            text: async () => '{}', headers: new Headers(),
          } as Response;
        }

        if (url.includes('/oauth2/default/token')) {
          return {
            ok: true, status: 200, statusText: 'OK',
            json: async () => ({ access_token: 'token', token_type: 'Bearer', expires_in: 3600 }),
            text: async () => '{}', headers: new Headers(),
          } as Response;
        }

        if (init?.method === 'POST' && !url.includes('token')) {
          postCallCount++;
          if (postCallCount === 2 || postCallCount === 4) {
            return {
              ok: false, status: 422, statusText: 'Unprocessable Entity',
              json: async () => ({}),
              text: async () => 'Validation error', headers: new Headers(),
            } as Response;
          }
          return {
            ok: true, status: 200, statusText: 'OK',
            json: async () => ({ resourceType: 'Bundle', type: 'transaction-response' }),
            text: async () => '{}', headers: new Headers(),
          } as Response;
        }

        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}), text: async () => '', headers: new Headers() } as Response;
      };

      const config: LoaderConfig = {
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        fetchFn: mockFetch,
      };

      const summary = await loadSyntheaData(tempDir, config);

      expect(summary.total).toBe(5);
      expect(summary.successful).toBe(3);
      expect(summary.failed).toBe(2);
      expect(summary.successful + summary.failed).toBe(summary.total);
    });
  });
});
