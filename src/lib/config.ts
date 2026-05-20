/**
 * Configuration validator for the Ambient Clinical Documentation Demo.
 *
 * Reads and validates required environment variables at startup.
 * Secrets (OPENEMR_CLIENT_ID, OPENEMR_CLIENT_SECRET) are read from
 * AWS Secrets Manager at runtime, not from environment variables.
 *
 * @see Requirements 10.4, 11.2, 11.3, 13.8
 */

/** Required environment variables that must be set for the application to start. */
const REQUIRED_ENV_VARS = [
  'AWS_REGION',
  'S3_OUTPUT_BUCKET',
  'OPENEMR_FHIR_BASE_URL',
  'CONNECT_HEALTH_DOMAIN_NAME',
] as const;

/** AWS regions supported by Amazon Connect Health ambient documentation. */
const SUPPORTED_REGIONS = ['us-east-1', 'us-west-2'] as const;

type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

/**
 * Validated application configuration (without secrets).
 * Secrets are retrieved from AWS Secrets Manager at runtime.
 */
export interface ValidatedConfig {
  aws: {
    region: SupportedRegion;
    s3OutputBucket: string;
  };
  openemr: {
    fhirBaseUrl: string;
  };
  connectHealth: {
    domainName: string;
  };
}

/**
 * Validates that the given region string is a supported AWS region.
 *
 * @param region - The region string to validate
 * @returns true if the region is 'us-east-1' or 'us-west-2', false otherwise
 */
export function validateRegion(region: string): region is SupportedRegion {
  return (SUPPORTED_REGIONS as readonly string[]).includes(region);
}

/**
 * Result of configuration validation.
 * Either a valid config or a list of error messages.
 */
export type ConfigValidationResult =
  | { valid: true; config: ValidatedConfig }
  | { valid: false; errors: string[] };

/**
 * Validates all required environment variables and returns the config or errors.
 * This function is pure and testable — it does not call process.exit.
 *
 * @returns A ConfigValidationResult indicating success with config or failure with error list
 */
export function validateConfig(): ConfigValidationResult {
  const missing: string[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    return {
      valid: false,
      errors: [`Missing required environment variables: ${missing.join(', ')}`],
    };
  }

  const region = process.env['AWS_REGION']!;
  if (!validateRegion(region)) {
    return {
      valid: false,
      errors: [
        `Invalid AWS_REGION "${region}". Supported regions: ${SUPPORTED_REGIONS.join(', ')}`,
      ],
    };
  }

  return {
    valid: true,
    config: {
      aws: {
        region,
        s3OutputBucket: process.env['S3_OUTPUT_BUCKET']!,
      },
      openemr: {
        fhirBaseUrl: process.env['OPENEMR_FHIR_BASE_URL']!,
      },
      connectHealth: {
        domainName: process.env['CONNECT_HEALTH_DOMAIN_NAME']!,
      },
    },
  };
}

/**
 * Validates configuration and returns it, or exits the process with a non-zero status.
 * This is the entry point for application startup — it prints errors and exits if invalid.
 *
 * @returns The validated configuration if all checks pass
 */
export function getConfig(): ValidatedConfig {
  const result = validateConfig();

  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`[CONFIG ERROR] ${error}`);
    }
    process.exit(1);
  }

  return result.config;
}
