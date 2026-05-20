import { validateConfig, validateRegion, getConfig, type ValidatedConfig } from './config';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function setAllRequiredEnvVars(): void {
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['S3_OUTPUT_BUCKET'] = 'my-output-bucket';
    process.env['OPENEMR_FHIR_BASE_URL'] = 'https://openemr.example.com/fhir';
    process.env['CONNECT_HEALTH_DOMAIN_NAME'] = 'my-domain';
  }

  describe('validateRegion', () => {
    it('accepts us-east-1', () => {
      expect(validateRegion('us-east-1')).toBe(true);
    });

    it('accepts us-west-2', () => {
      expect(validateRegion('us-west-2')).toBe(true);
    });

    it('rejects us-west-1', () => {
      expect(validateRegion('us-west-1')).toBe(false);
    });

    it('rejects eu-west-1', () => {
      expect(validateRegion('eu-west-1')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(validateRegion('')).toBe(false);
    });

    it('rejects arbitrary string', () => {
      expect(validateRegion('not-a-region')).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('returns valid config when all env vars are set with supported region', () => {
      setAllRequiredEnvVars();

      const result = validateConfig();

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config).toEqual<ValidatedConfig>({
          aws: {
            region: 'us-east-1',
            s3OutputBucket: 'my-output-bucket',
          },
          openemr: {
            fhirBaseUrl: 'https://openemr.example.com/fhir',
          },
          connectHealth: {
            domainName: 'my-domain',
          },
        });
      }
    });

    it('returns valid config for us-west-2 region', () => {
      setAllRequiredEnvVars();
      process.env['AWS_REGION'] = 'us-west-2';

      const result = validateConfig();

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config.aws.region).toBe('us-west-2');
      }
    });

    it('reports a single missing variable', () => {
      setAllRequiredEnvVars();
      delete process.env['S3_OUTPUT_BUCKET'];

      const result = validateConfig();

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]).toContain('S3_OUTPUT_BUCKET');
      }
    });

    it('reports all missing variables when multiple are absent', () => {
      // Set none of the required vars
      delete process.env['AWS_REGION'];
      delete process.env['S3_OUTPUT_BUCKET'];
      delete process.env['OPENEMR_FHIR_BASE_URL'];
      delete process.env['CONNECT_HEALTH_DOMAIN_NAME'];

      const result = validateConfig();

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]).toContain('AWS_REGION');
        expect(result.errors[0]).toContain('S3_OUTPUT_BUCKET');
        expect(result.errors[0]).toContain('OPENEMR_FHIR_BASE_URL');
        expect(result.errors[0]).toContain('CONNECT_HEALTH_DOMAIN_NAME');
      }
    });

    it('treats empty string as missing', () => {
      setAllRequiredEnvVars();
      process.env['AWS_REGION'] = '';

      const result = validateConfig();

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]).toContain('AWS_REGION');
      }
    });

    it('treats whitespace-only string as missing', () => {
      setAllRequiredEnvVars();
      process.env['OPENEMR_FHIR_BASE_URL'] = '   ';

      const result = validateConfig();

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]).toContain('OPENEMR_FHIR_BASE_URL');
      }
    });

    it('returns error for unsupported region', () => {
      setAllRequiredEnvVars();
      process.env['AWS_REGION'] = 'eu-central-1';

      const result = validateConfig();

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]).toContain('eu-central-1');
        expect(result.errors[0]).toContain('us-east-1');
        expect(result.errors[0]).toContain('us-west-2');
      }
    });

    it('does not require OPENEMR_CLIENT_ID or OPENEMR_CLIENT_SECRET', () => {
      setAllRequiredEnvVars();
      // Explicitly ensure secrets are NOT set
      delete process.env['OPENEMR_CLIENT_ID'];
      delete process.env['OPENEMR_CLIENT_SECRET'];

      const result = validateConfig();

      expect(result.valid).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('returns validated config when all env vars are valid', () => {
      setAllRequiredEnvVars();

      const config = getConfig();

      expect(config.aws.region).toBe('us-east-1');
      expect(config.aws.s3OutputBucket).toBe('my-output-bucket');
      expect(config.openemr.fhirBaseUrl).toBe('https://openemr.example.com/fhir');
      expect(config.connectHealth.domainName).toBe('my-domain');
    });

    it('calls process.exit(1) when env vars are missing', () => {
      delete process.env['AWS_REGION'];
      delete process.env['S3_OUTPUT_BUCKET'];

      const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit called');
      }) as never);
      const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => getConfig()).toThrow('process.exit called');
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockConsoleError).toHaveBeenCalled();

      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });

    it('logs error message listing missing variables before exiting', () => {
      delete process.env['AWS_REGION'];
      delete process.env['S3_OUTPUT_BUCKET'];
      delete process.env['OPENEMR_FHIR_BASE_URL'];
      delete process.env['CONNECT_HEALTH_DOMAIN_NAME'];

      const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit called');
      }) as never);
      const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => getConfig()).toThrow('process.exit called');

      const errorOutput = mockConsoleError.mock.calls.map(c => c[0]).join(' ');
      expect(errorOutput).toContain('AWS_REGION');
      expect(errorOutput).toContain('S3_OUTPUT_BUCKET');
      expect(errorOutput).toContain('OPENEMR_FHIR_BASE_URL');
      expect(errorOutput).toContain('CONNECT_HEALTH_DOMAIN_NAME');

      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });
  });
});
