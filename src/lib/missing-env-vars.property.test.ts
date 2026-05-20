// Feature: ambient-clinical-documentation-demo, Property 11: Missing environment variable reporting
import * as fc from 'fast-check';
import { validateConfig } from './config';

/**
 * Property 11: Missing environment variable reporting
 *
 * For any subset of required environment variables where at least one is missing,
 * the application SHALL exit with non-zero status and the error message SHALL list
 * every missing variable by name.
 *
 * **Validates: Requirements 10.4**
 */
describe('Property 11: Missing environment variable reporting', () => {
  const REQUIRED_ENV_VARS = [
    'AWS_REGION',
    'S3_OUTPUT_BUCKET',
    'OPENEMR_FHIR_BASE_URL',
    'CONNECT_HEALTH_DOMAIN_NAME',
  ] as const;

  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /**
   * Helper: set all required env vars to valid values.
   */
  function setAllValid(): void {
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['S3_OUTPUT_BUCKET'] = 'test-bucket';
    process.env['OPENEMR_FHIR_BASE_URL'] = 'https://example.com/fhir';
    process.env['CONNECT_HEALTH_DOMAIN_NAME'] = 'test-domain';
  }

  it('for any non-empty subset of required vars that are missing, validateConfig returns { valid: false }', () => {
    // Generate non-empty subsets of required env var indices
    const nonEmptySubsetArb = fc
      .subarray([0, 1, 2, 3], { minLength: 1 })
      .map((indices) => indices.map((i) => REQUIRED_ENV_VARS[i]));

    fc.assert(
      fc.property(nonEmptySubsetArb, (missingVars) => {
        // Start with all vars set to valid values
        setAllValid();

        // Remove the selected subset
        for (const varName of missingVars) {
          delete process.env[varName];
        }

        const result = validateConfig();
        return result.valid === false;
      }),
      { numRuns: 100 }
    );
  });

  it('for any non-empty subset of required vars that are missing, every missing var name appears in the error message', () => {
    const nonEmptySubsetArb = fc
      .subarray([0, 1, 2, 3], { minLength: 1 })
      .map((indices) => indices.map((i) => REQUIRED_ENV_VARS[i]));

    fc.assert(
      fc.property(nonEmptySubsetArb, (missingVars) => {
        setAllValid();

        for (const varName of missingVars) {
          delete process.env[varName];
        }

        const result = validateConfig();
        if (result.valid) return false;

        const errorText = result.errors.join(' ');
        return missingVars.every((varName) => errorText.includes(varName));
      }),
      { numRuns: 100 }
    );
  });

  it('empty string and whitespace-only values are treated as missing', () => {
    // Generate a non-empty subset of vars and assign empty/whitespace values
    const nonEmptySubsetArb = fc
      .subarray([0, 1, 2, 3], { minLength: 1 })
      .map((indices) => indices.map((i) => REQUIRED_ENV_VARS[i]));

    // Generate whitespace-only strings (empty or spaces/tabs/newlines)
    const whitespaceArb = fc.constantFrom('', ' ', '  ', '\t', '\n', '  \t\n  ');

    fc.assert(
      fc.property(nonEmptySubsetArb, whitespaceArb, (missingVars, whitespace) => {
        setAllValid();

        // Set the selected vars to empty/whitespace values instead of deleting
        for (const varName of missingVars) {
          process.env[varName] = whitespace;
        }

        const result = validateConfig();
        if (result.valid) return false;

        const errorText = result.errors.join(' ');
        return missingVars.every((varName) => errorText.includes(varName));
      }),
      { numRuns: 100 }
    );
  });
});
