// Feature: ambient-clinical-documentation-demo, Property 11: Missing environment variable reporting
// **Validates: Requirements 10.4**

// Feature: ambient-clinical-documentation-demo, Property 12: Region validation
// **Validates: Requirements 11.2, 11.3**

import * as fc from 'fast-check';
import { validateConfig, validateRegion } from './config';

const REQUIRED_ENV_VARS = [
  'AWS_REGION',
  'S3_OUTPUT_BUCKET',
  'OPENEMR_FHIR_BASE_URL',
  'CONNECT_HEALTH_DOMAIN_NAME',
] as const;

/**
 * Arbitrary that generates a subset of required env vars to SET (present),
 * ensuring at least one is MISSING. The missing vars are the complement.
 */
const subsetWithAtLeastOneMissing = fc
  .subarray([...REQUIRED_ENV_VARS], { minLength: 0, maxLength: REQUIRED_ENV_VARS.length - 1 })
  .map((presentVars) => {
    const missingVars = REQUIRED_ENV_VARS.filter((v) => !presentVars.includes(v));
    return { presentVars, missingVars };
  });

describe('Property 11: Missing environment variable reporting', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('for any subset with at least one missing var, validateConfig returns invalid and error lists every missing variable', () => {
    fc.assert(
      fc.property(subsetWithAtLeastOneMissing, ({ presentVars, missingVars }) => {
        // Clear all required env vars first
        for (const varName of REQUIRED_ENV_VARS) {
          delete process.env[varName];
        }

        // Set only the present vars with valid values
        for (const varName of presentVars) {
          if (varName === 'AWS_REGION') {
            process.env[varName] = 'us-east-1';
          } else if (varName === 'S3_OUTPUT_BUCKET') {
            process.env[varName] = 'test-bucket';
          } else if (varName === 'OPENEMR_FHIR_BASE_URL') {
            process.env[varName] = 'https://openemr.example.com/fhir';
          } else if (varName === 'CONNECT_HEALTH_DOMAIN_NAME') {
            process.env[varName] = 'test-domain';
          }
        }

        const result = validateConfig();

        // Must be invalid when at least one var is missing
        expect(result.valid).toBe(false);

        if (!result.valid) {
          // The error message must list every missing variable by name
          const errorMessage = result.errors.join(' ');
          for (const missingVar of missingVars) {
            expect(errorMessage).toContain(missingVar);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: ambient-clinical-documentation-demo, Property 12: Region validation
describe('Property 12: Region validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /**
   * Helper to set all required env vars with valid values.
   * The AWS_REGION is set to the provided region value.
   */
  function setEnvWithRegion(region: string): void {
    process.env['AWS_REGION'] = region;
    process.env['S3_OUTPUT_BUCKET'] = 'test-bucket';
    process.env['OPENEMR_FHIR_BASE_URL'] = 'https://openemr.example.com/fhir';
    process.env['CONNECT_HEALTH_DOMAIN_NAME'] = 'test-domain';
  }

  it('validateRegion accepts only "us-east-1" and "us-west-2"', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('us-east-1', 'us-west-2'),
        (region) => {
          expect(validateRegion(region)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('validateRegion rejects all region strings that are not "us-east-1" or "us-west-2"', () => {
    // Generate arbitrary strings that are NOT the two supported regions
    const nonSupportedRegion = fc.string().filter(
      (s) => s !== 'us-east-1' && s !== 'us-west-2',
    );

    fc.assert(
      fc.property(nonSupportedRegion, (region) => {
        expect(validateRegion(region)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('validateRegion rejects other real AWS region names', () => {
    const otherAwsRegions = fc.constantFrom(
      'us-east-2',
      'us-west-1',
      'eu-west-1',
      'eu-west-2',
      'eu-central-1',
      'ap-southeast-1',
      'ap-southeast-2',
      'ap-northeast-1',
      'ap-northeast-2',
      'sa-east-1',
      'ca-central-1',
      'af-south-1',
      'me-south-1',
    );

    fc.assert(
      fc.property(otherAwsRegions, (region) => {
        expect(validateRegion(region)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('validateConfig returns invalid with error message specifying supported regions when region is unsupported', () => {
    // Generate arbitrary strings that are NOT the two supported regions
    const nonSupportedRegion = fc.string({ minLength: 1 }).filter(
      (s) => s !== 'us-east-1' && s !== 'us-west-2',
    );

    fc.assert(
      fc.property(nonSupportedRegion, (region) => {
        setEnvWithRegion(region);

        const result = validateConfig();

        // Must be invalid
        expect(result.valid).toBe(false);

        if (!result.valid) {
          const errorMessage = result.errors.join(' ');
          // Error message must specify the supported regions
          expect(errorMessage).toContain('us-east-1');
          expect(errorMessage).toContain('us-west-2');
          // Error message should mention the invalid region
          expect(errorMessage).toContain(region);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('validateConfig returns valid when region is a supported region', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('us-east-1', 'us-west-2'),
        (region) => {
          setEnvWithRegion(region);

          const result = validateConfig();

          expect(result.valid).toBe(true);
          if (result.valid) {
            expect(result.config.aws.region).toBe(region);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
