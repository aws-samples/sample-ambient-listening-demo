/**
 * Tests for the /api/health endpoint.
 *
 * @see Requirements 10.3
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

function validConfig() {
  return {
    valid: true as const,
    config: {
      aws: { region: 'us-east-1' as const, s3OutputBucket: 'test-bucket' },
      openemr: {
        fhirBaseUrl: 'https://openemr.example.com/fhir',
      },
      connectHealth: { domainName: 'test-domain' },
    },
  };
}

describe('GET /api/health', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns connected status when FHIR metadata request succeeds', async () => {
    mockValidateConfig.mockReturnValue(validConfig());

    const mockGetMetadata = jest.fn().mockResolvedValue({
      success: true,
      data: {
        resourceType: 'CapabilityStatement',
        fhirVersion: '4.0.1',
        status: 'active',
      },
    });

    mockCreateFHIRClient.mockReturnValue({
      getMetadata: mockGetMetadata,
    } as any);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('connected');
    expect(body.fhirVersion).toBe('4.0.1');
    expect(body.fhirStatus).toBe('active');
    expect(body.timestamp).toBeDefined();
  });

  it('returns disconnected status when FHIR metadata request fails', async () => {
    mockValidateConfig.mockReturnValue(validConfig());

    const mockGetMetadata = jest.fn().mockResolvedValue({
      success: false,
      error: 'FHIR request timed out after 10 seconds',
    });

    mockCreateFHIRClient.mockReturnValue({
      getMetadata: mockGetMetadata,
    } as any);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('disconnected');
    expect(body.error).toBe('FHIR request timed out after 10 seconds');
    expect(body.timestamp).toBeDefined();
  });

  it('returns disconnected status when config is invalid', async () => {
    mockValidateConfig.mockReturnValue({
      valid: false,
      errors: ['Missing required environment variables: OPENEMR_FHIR_BASE_URL, AWS_REGION'],
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('disconnected');
    expect(body.error).toContain('Configuration error');
    expect(body.error).toContain('OPENEMR_FHIR_BASE_URL');
    expect(body.error).toContain('AWS_REGION');
    expect(body.timestamp).toBeDefined();
  });

  it('returns disconnected with default error when FHIR error is undefined', async () => {
    mockValidateConfig.mockReturnValue(validConfig());

    const mockGetMetadata = jest.fn().mockResolvedValue({
      success: false,
      error: undefined,
    });

    mockCreateFHIRClient.mockReturnValue({
      getMetadata: mockGetMetadata,
    } as any);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('disconnected');
    expect(body.error).toBe('Failed to connect to FHIR API');
  });
});
