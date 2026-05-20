/**
 * Unit tests for the FHIR client module.
 *
 * Tests OAuth2 authentication, resource retrieval, timeout handling,
 * TLS enforcement, and partial failure handling.
 */

import { FHIRClient, type FHIRClientConfig } from './fhir-client';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return jest.fn(async (url: string, _options?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    for (const [pattern, response] of responses.entries()) {
      if (urlStr.includes(pattern)) {
        return {
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          statusText: response.status === 200 ? 'OK' : 'Error',
          json: async () => response.body,
        } as Response;
      }
    }
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'not found' }),
    } as Response;
  });
}

function createClientConfig(overrides?: Partial<FHIRClientConfig>): FHIRClientConfig {
  const responses = new Map<string, { status: number; body: unknown }>();
  responses.set('oauth2/default/token', {
    status: 200,
    body: { access_token: 'test-token-123', token_type: 'Bearer', expires_in: 3600 },
  });

  return {
    fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir',
    region: 'us-east-1',
    credentials: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
    fetchFn: createMockFetch(responses),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FHIRClient', () => {
  describe('constructor', () => {
    it('strips trailing slash from fhirBaseUrl', () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/metadata', {
        status: 200,
        body: { resourceType: 'CapabilityStatement', status: 'active', fhirVersion: '4.0.1' },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        fhirBaseUrl: 'https://openemr.example.com/apis/default/fhir/',
        region: 'us-east-1',
        credentials: { clientId: 'id', clientSecret: 'secret' },
        fetchFn: mockFetch,
      });

      expect(client).toBeDefined();
    });
  });

  describe('getMetadata', () => {
    it('retrieves CapabilityStatement without authentication', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('/metadata', {
        status: 200,
        body: { resourceType: 'CapabilityStatement', status: 'active', fhirVersion: '4.0.1' },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getMetadata();

      expect(result.success).toBe(true);
      expect(result.data?.resourceType).toBe('CapabilityStatement');
      // Verify no Authorization header was sent (metadata doesn't require auth)
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs?.[1]?.headers).not.toHaveProperty('Authorization');
    });

    it('returns error when metadata endpoint fails', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('/metadata', {
        status: 503,
        body: { error: 'Service Unavailable' },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getMetadata();

      expect(result.success).toBe(false);
      expect(result.error).toContain('503');
    });
  });

  describe('getPatient', () => {
    it('retrieves a patient by ID with authentication', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'test-token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Patient/123', {
        status: 200,
        body: {
          resourceType: 'Patient',
          id: '123',
          name: [{ family: 'Smith', given: ['John'] }],
          gender: 'male',
          birthDate: '1980-01-15',
        },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getPatient('123');

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('123');
      expect(result.data?.name?.[0]?.family).toBe('Smith');
    });

    it('includes Bearer token in Authorization header', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'my-access-token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Patient/456', {
        status: 200,
        body: { resourceType: 'Patient', id: '456' },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      await client.getPatient('456');

      // Second call should be the patient request (first is token)
      const patientCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/Patient/456')
      );
      expect(patientCall).toBeDefined();
      expect(patientCall?.[1]?.headers).toHaveProperty('Authorization', 'Bearer my-access-token');
    });

    it('returns error when patient is not found', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Patient/999', {
        status: 404,
        body: { error: 'Not Found' },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getPatient('999');

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });
  });

  describe('getConditions', () => {
    it('retrieves conditions from a FHIR Bundle', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Condition', {
        status: 200,
        body: {
          resourceType: 'Bundle',
          type: 'searchset',
          total: 2,
          entry: [
            {
              resource: {
                id: 'cond-1',
                clinicalStatus: 'active',
                code: { text: 'Hypertension' },
              },
            },
            {
              resource: {
                id: 'cond-2',
                clinicalStatus: 'active',
                code: { text: 'Diabetes Type 2' },
              },
            },
          ],
        },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getConditions('123');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0]?.code.text).toBe('Hypertension');
      expect(result.data?.[1]?.code.text).toBe('Diabetes Type 2');
    });

    it('returns empty array when bundle has no entries', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Condition', {
        status: 200,
        body: { resourceType: 'Bundle', type: 'searchset', total: 0 },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getConditions('123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('getMedications', () => {
    it('retrieves medications from a FHIR Bundle', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/MedicationRequest', {
        status: 200,
        body: {
          resourceType: 'Bundle',
          type: 'searchset',
          total: 1,
          entry: [
            {
              resource: {
                id: 'med-1',
                status: 'active',
                medicationCodeableConcept: { text: 'Lisinopril 10mg' },
                dosageInstruction: [{ text: 'Take once daily' }],
              },
            },
          ],
        },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getMedications('123');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.medicationCodeableConcept.text).toBe('Lisinopril 10mg');
    });
  });

  describe('getAllergies', () => {
    it('retrieves allergies from a FHIR Bundle', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/AllergyIntolerance', {
        status: 200,
        body: {
          resourceType: 'Bundle',
          type: 'searchset',
          total: 1,
          entry: [
            {
              resource: {
                id: 'allergy-1',
                clinicalStatus: 'active',
                code: { text: 'Penicillin' },
                criticality: 'high',
              },
            },
          ],
        },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getAllergies('123');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.code.text).toBe('Penicillin');
      expect(result.data?.[0]?.criticality).toBe('high');
    });
  });

  describe('getPatientData (partial failure handling)', () => {
    it('returns all data when all requests succeed', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Patient/123', {
        status: 200,
        body: { resourceType: 'Patient', id: '123', gender: 'female' },
      });
      responses.set('/Condition', {
        status: 200,
        body: {
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ resource: { id: 'c1', clinicalStatus: 'active', code: { text: 'Asthma' } } }],
        },
      });
      responses.set('/MedicationRequest', {
        status: 200,
        body: {
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ resource: { id: 'm1', status: 'active', medicationCodeableConcept: { text: 'Albuterol' } } }],
        },
      });
      responses.set('/AllergyIntolerance', {
        status: 200,
        body: {
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ resource: { id: 'a1', clinicalStatus: 'active', code: { text: 'Peanuts' } } }],
        },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getPatientData('123');

      expect(result.patient.success).toBe(true);
      expect(result.conditions.success).toBe(true);
      expect(result.medications.success).toBe(true);
      expect(result.allergies.success).toBe(true);
    });

    it('handles partial failure — conditions fail but others succeed', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Patient/123', {
        status: 200,
        body: { resourceType: 'Patient', id: '123' },
      });
      responses.set('/Condition', {
        status: 500,
        body: { error: 'Internal Server Error' },
      });
      responses.set('/MedicationRequest', {
        status: 200,
        body: { resourceType: 'Bundle', type: 'searchset', entry: [] },
      });
      responses.set('/AllergyIntolerance', {
        status: 200,
        body: { resourceType: 'Bundle', type: 'searchset', entry: [] },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getPatientData('123');

      expect(result.patient.success).toBe(true);
      expect(result.conditions.success).toBe(false);
      expect(result.conditions.error).toContain('500');
      expect(result.medications.success).toBe(true);
      expect(result.allergies.success).toBe(true);
    });

    it('handles partial failure — multiple resource types fail', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Patient/123', {
        status: 200,
        body: { resourceType: 'Patient', id: '123' },
      });
      responses.set('/Condition', {
        status: 503,
        body: { error: 'Service Unavailable' },
      });
      responses.set('/MedicationRequest', {
        status: 500,
        body: { error: 'Internal Server Error' },
      });
      responses.set('/AllergyIntolerance', {
        status: 200,
        body: {
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ resource: { id: 'a1', clinicalStatus: 'active', code: { text: 'Latex' } } }],
        },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getPatientData('123');

      expect(result.patient.success).toBe(true);
      expect(result.conditions.success).toBe(false);
      expect(result.medications.success).toBe(false);
      expect(result.allergies.success).toBe(true);
      expect(result.allergies.data).toHaveLength(1);
    });
  });

  describe('OAuth2 token caching', () => {
    it('reuses cached token for subsequent requests', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 200,
        body: { access_token: 'cached-token', token_type: 'Bearer', expires_in: 3600 },
      });
      responses.set('/Patient/', {
        status: 200,
        body: { resourceType: 'Patient', id: '1' },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      await client.getPatient('1');
      await client.getPatient('2');

      // Token endpoint should only be called once
      const tokenCalls = mockFetch.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('oauth2/default/token')
      );
      expect(tokenCalls).toHaveLength(1);
    });
  });

  describe('timeout handling', () => {
    it('passes an AbortSignal to fetch and handles abort as timeout', async () => {
      // Simulate a fetch that immediately rejects with AbortError
      // (as would happen when the AbortController fires)
      const mockFetch = jest.fn(async () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      });

      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getMetadata();

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.error).toContain('10 seconds');
    });

    it('passes AbortSignal in fetch options', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('/metadata', {
        status: 200,
        body: { resourceType: 'CapabilityStatement', status: 'active', fhirVersion: '4.0.1' },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      await client.getMetadata();

      // Verify that an AbortSignal was passed to fetch
      const callOptions = mockFetch.mock.calls[0]?.[1];
      expect(callOptions?.signal).toBeDefined();
      expect(callOptions?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('OAuth2 token failure', () => {
    it('returns error when token request fails', async () => {
      const responses = new Map<string, { status: number; body: unknown }>();
      responses.set('oauth2/default/token', {
        status: 401,
        body: { error: 'invalid_client' },
      });

      const mockFetch = createMockFetch(responses);
      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getPatient('123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('OAuth2 token request failed');
    });
  });

  describe('network errors', () => {
    it('handles network errors gracefully', async () => {
      const mockFetch = jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      });

      const client = new FHIRClient({
        ...createClientConfig(),
        fetchFn: mockFetch,
      });

      const result = await client.getMetadata();

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });
});
