/**
 * Unit tests for GET /api/patients route.
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

import { validateConfig } from '@/lib/config';
import { createFHIRClient } from '@/lib/fhir-client';

const mockValidateConfig = validateConfig as jest.MockedFunction<typeof validateConfig>;
const mockCreateFHIRClient = createFHIRClient as jest.MockedFunction<typeof createFHIRClient>;

describe('GET /api/patients', () => {
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

  it('returns 500 when config is invalid', async () => {
    mockValidateConfig.mockReturnValue({
      valid: false,
      errors: ['Missing required environment variables: AWS_REGION'],
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('CONFIG_ERROR');
    expect(body.message).toContain('AWS_REGION');
  });

  it('returns patient list with id, name, and dateOfBirth', async () => {
    setupValidConfig();

    const mockClient = {
      searchPatients: jest.fn().mockResolvedValue({
        success: true,
        data: [
          {
            resourceType: 'Patient',
            id: '123',
            name: [{ given: ['John'], family: 'Doe' }],
            birthDate: '1990-01-15',
          },
          {
            resourceType: 'Patient',
            id: '456',
            name: [{ text: 'Jane Smith' }],
            birthDate: '1985-06-20',
          },
        ],
      }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({ id: '123', name: 'John Doe', dateOfBirth: '1990-01-15' });
    expect(body[1]).toEqual({ id: '456', name: 'Jane Smith', dateOfBirth: '1985-06-20' });
  });

  it('returns "Unknown" name when patient has no name', async () => {
    setupValidConfig();

    const mockClient = {
      searchPatients: jest.fn().mockResolvedValue({
        success: true,
        data: [
          { resourceType: 'Patient', id: '789', birthDate: '2000-03-10' },
        ],
      }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[0]).toEqual({ id: '789', name: 'Unknown', dateOfBirth: '2000-03-10' });
  });

  it('returns null dateOfBirth when patient has no birthDate', async () => {
    setupValidConfig();

    const mockClient = {
      searchPatients: jest.fn().mockResolvedValue({
        success: true,
        data: [
          { resourceType: 'Patient', id: '101', name: [{ given: ['Alice'] }] },
        ],
      }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[0]).toEqual({ id: '101', name: 'Alice', dateOfBirth: null });
  });

  it('returns 504 when FHIR API times out', async () => {
    setupValidConfig();

    const mockClient = {
      searchPatients: jest.fn().mockResolvedValue({
        success: false,
        error: 'FHIR request timed out after 10 seconds',
      }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.code).toBe('GATEWAY_TIMEOUT');
  });

  it('returns 502 when FHIR API returns a non-timeout error', async () => {
    setupValidConfig();

    const mockClient = {
      searchPatients: jest.fn().mockResolvedValue({
        success: false,
        error: 'FHIR request failed: 500 Internal Server Error',
      }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe('FHIR_ERROR');
  });

  it('returns empty array when no patients exist', async () => {
    setupValidConfig();

    const mockClient = {
      searchPatients: jest.fn().mockResolvedValue({
        success: true,
        data: [],
      }),
    };
    mockCreateFHIRClient.mockReturnValue(mockClient as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });
});
