/**
 * Unit tests for GET /api/patients/:id/context route.
 */

import { GET } from './route';

// Mock the config module
jest.mock('@/lib/config', () => ({
  validateConfig: jest.fn(),
}));

// Mock the fhir-client module
jest.mock('@/lib/fhir-client', () => ({
  createFHIRClient: jest.fn(),
}));

// Mock the patient-context-formatter module
jest.mock('@/lib/patient-context-formatter', () => ({
  processPatientDataResult: jest.fn(),
}));

import { validateConfig } from '@/lib/config';
import { createFHIRClient } from '@/lib/fhir-client';
import { processPatientDataResult } from '@/lib/patient-context-formatter';

const mockValidateConfig = validateConfig as jest.MockedFunction<typeof validateConfig>;
const mockCreateFHIRClient = createFHIRClient as jest.MockedFunction<typeof createFHIRClient>;
const mockProcessPatientDataResult = processPatientDataResult as jest.MockedFunction<typeof processPatientDataResult>;

describe('GET /api/patients/:id/context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setupValidConfig() {
    mockValidateConfig.mockReturnValue({
      valid: true,
      config: {
        aws: { region: 'us-east-1', s3OutputBucket: 'bucket' },
        openemr: { fhirBaseUrl: 'https://fhir.example.com/fhir' },
        connectHealth: { domainName: 'test-domain' },
      },
    });
  }

  function createMockRequest(): Request {
    return new Request('http://localhost/api/patients/123/context');
  }

  it('returns 500 when config is invalid', async () => {
    mockValidateConfig.mockReturnValue({
      valid: false,
      errors: ['Missing required environment variables: AWS_REGION'],
    });

    const response = await GET(createMockRequest(), { params: { id: '123' } });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('CONFIG_ERROR');
  });

  it('returns 504 when patient retrieval times out', async () => {
    setupValidConfig();

    const mockClient = {
      getPatient: jest.fn().mockResolvedValue({
        success: false,
        error: 'FHIR request timed out after 10 seconds',
      }),
      getConditions: jest.fn(),
      getMedications: jest.fn(),
      getAllergies: jest.fn(),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET(createMockRequest(), { params: { id: '123' } });
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.code).toBe('GATEWAY_TIMEOUT');
  });

  it('returns 502 when patient retrieval fails with non-timeout error', async () => {
    setupValidConfig();

    const mockClient = {
      getPatient: jest.fn().mockResolvedValue({
        success: false,
        error: 'FHIR request failed: 404 Not Found',
      }),
      getConditions: jest.fn(),
      getMedications: jest.fn(),
      getAllergies: jest.fn(),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET(createMockRequest(), { params: { id: '123' } });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe('FHIR_ERROR');
  });

  it('returns formatted context when all resources succeed', async () => {
    setupValidConfig();

    const mockClient = {
      getPatient: jest.fn().mockResolvedValue({
        success: true,
        data: {
          resourceType: 'Patient',
          id: '123',
          name: [{ given: ['John'], family: 'Doe' }],
          gender: 'male',
          birthDate: '1990-01-15',
        },
      }),
      getConditions: jest.fn().mockResolvedValue({ success: true, data: [] }),
      getMedications: jest.fn().mockResolvedValue({ success: true, data: [] }),
      getAllergies: jest.fn().mockResolvedValue({ success: true, data: [] }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    mockProcessPatientDataResult.mockReturnValue({
      formattedContext: '=== Patient Demographics ===\nName: John Doe\nAge: 35\nSex: male\nDate of Birth: 1990-01-15',
      warning: null,
      failedResourceTypes: [],
      successfulResourceTypes: ['conditions', 'medications', 'allergies'],
    });

    const response = await GET(createMockRequest(), { params: { id: '123' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.context).toContain('John Doe');
    expect(body.warnings).toBeUndefined();
  });

  it('returns context with warnings when some resources fail', async () => {
    setupValidConfig();

    const mockClient = {
      getPatient: jest.fn().mockResolvedValue({
        success: true,
        data: {
          resourceType: 'Patient',
          id: '123',
          name: [{ given: ['John'], family: 'Doe' }],
          gender: 'male',
          birthDate: '1990-01-15',
        },
      }),
      getConditions: jest.fn().mockResolvedValue({ success: false, error: 'Server error' }),
      getMedications: jest.fn().mockResolvedValue({ success: true, data: [] }),
      getAllergies: jest.fn().mockResolvedValue({ success: false, error: 'Server error' }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    mockProcessPatientDataResult.mockReturnValue({
      formattedContext: '=== Patient Demographics ===\nName: John Doe',
      warning: 'The following resource types could not be loaded: allergies, conditions',
      failedResourceTypes: ['allergies', 'conditions'],
      successfulResourceTypes: ['medications'],
    });

    const response = await GET(createMockRequest(), { params: { id: '123' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.context).toBeDefined();
    expect(body.warnings).toEqual(['The following resource types could not be loaded: allergies, conditions']);
  });

  it('returns 504 when all resource types time out', async () => {
    setupValidConfig();

    const mockClient = {
      getPatient: jest.fn().mockResolvedValue({
        success: true,
        data: {
          resourceType: 'Patient',
          id: '123',
          name: [{ given: ['John'], family: 'Doe' }],
          gender: 'male',
          birthDate: '1990-01-15',
        },
      }),
      getConditions: jest.fn().mockResolvedValue({
        success: false,
        error: 'FHIR request timed out after 10 seconds',
      }),
      getMedications: jest.fn().mockResolvedValue({
        success: false,
        error: 'FHIR request timed out after 10 seconds',
      }),
      getAllergies: jest.fn().mockResolvedValue({
        success: false,
        error: 'FHIR request timed out after 10 seconds',
      }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET(createMockRequest(), { params: { id: '123' } });
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.code).toBe('GATEWAY_TIMEOUT');
  });

  it('passes correct demographics to processPatientDataResult', async () => {
    setupValidConfig();

    const mockClient = {
      getPatient: jest.fn().mockResolvedValue({
        success: true,
        data: {
          resourceType: 'Patient',
          id: '123',
          name: [{ text: 'Jane Smith' }],
          gender: 'female',
          birthDate: '1985-06-20',
        },
      }),
      getConditions: jest.fn().mockResolvedValue({ success: true, data: [] }),
      getMedications: jest.fn().mockResolvedValue({ success: true, data: [] }),
      getAllergies: jest.fn().mockResolvedValue({ success: true, data: [] }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    mockProcessPatientDataResult.mockReturnValue({
      formattedContext: 'test context',
      warning: null,
      failedResourceTypes: [],
      successfulResourceTypes: ['conditions', 'medications', 'allergies'],
    });

    await GET(createMockRequest(), { params: { id: '123' } });

    expect(mockProcessPatientDataResult).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: expect.objectContaining({ success: true }),
        conditions: expect.objectContaining({ success: true }),
        medications: expect.objectContaining({ success: true }),
        allergies: expect.objectContaining({ success: true }),
      }),
      expect.objectContaining({
        name: 'Jane Smith',
        sex: 'female',
        dateOfBirth: '1985-06-20',
      })
    );
  });
});
