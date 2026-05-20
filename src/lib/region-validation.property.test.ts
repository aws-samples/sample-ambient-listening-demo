// Feature: ambient-clinical-documentation-demo, Property 12: Region validation
import * as fc from 'fast-check';
import { validateRegion, validateConfig } from './config';

/**
 * Property 12: Region validation
 *
 * For any AWS region string, the validation function SHALL accept only
 * "us-east-1" and "us-west-2" and reject all other values, blocking
 * session creation for rejected values.
 *
 * **Validates: Requirements 11.2, 11.3**
 */
describe('Property 12: Region validation', () => {
  const SUPPORTED_REGIONS = ['us-east-1', 'us-west-2'];

  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('validateRegion returns true ONLY for us-east-1 and us-west-2', () => {
    fc.assert(
      fc.property(fc.string(), (region) => {
        const result = validateRegion(region);
        if (SUPPORTED_REGIONS.includes(region)) {
          return result === true;
        } else {
          return result === false;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('validateRegion returns false for any string that is NOT us-east-1 or us-west-2', () => {
    // Generate arbitrary strings that are guaranteed NOT to be a supported region
    const nonRegionArb = fc.string().filter(
      (s) => !SUPPORTED_REGIONS.includes(s)
    );

    fc.assert(
      fc.property(nonRegionArb, (region) => {
        return validateRegion(region) === false;
      }),
      { numRuns: 100 }
    );
  });

  it('validateRegion always accepts the two supported regions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('us-east-1', 'us-west-2'),
        (region) => {
          return validateRegion(region) === true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validateConfig returns { valid: false } with error mentioning supported regions when AWS_REGION is invalid', () => {
    // Generate arbitrary strings that are NOT supported regions
    const invalidRegionArb = fc.string({ minLength: 1 }).filter(
      (s) => !SUPPORTED_REGIONS.includes(s) && s.trim() !== ''
    );

    fc.assert(
      fc.property(invalidRegionArb, (invalidRegion) => {
        // Set all required env vars with a valid configuration except region
        process.env['AWS_REGION'] = invalidRegion;
        process.env['S3_OUTPUT_BUCKET'] = 'test-bucket';
        process.env['OPENEMR_FHIR_BASE_URL'] = 'https://example.com/fhir';
        process.env['CONNECT_HEALTH_DOMAIN_NAME'] = 'test-domain';

        const result = validateConfig();

        if (result.valid) {
          return false; // Should not be valid with an unsupported region
        }

        // Error should mention the supported regions
        const errorText = result.errors.join(' ');
        return (
          errorText.includes('us-east-1') &&
          errorText.includes('us-west-2')
        );
      }),
      { numRuns: 100 }
    );
  });
});
