/**
 * Security group ingress validation utility.
 *
 * Validates that security group configurations follow security best practices:
 * - No ingress rule allows traffic from 0.0.0.0/0 or ::/0 (open internet)
 * - ALB security groups only allow inbound on port 443 from a specific CIDR
 *
 * This utility is used by the CDK stack to validate security group rules
 * before deployment, and is independently testable via property-based tests.
 *
 * @see Requirements 13.1, 13.2
 */

/** Represents a single security group ingress rule. */
export interface SecurityGroupRule {
  port: number;
  protocol: string;
  sourceCidr: string;
}

/** Represents a security group configuration with its ingress rules. */
export interface SecurityGroupConfig {
  name: string;
  type: 'alb' | 'ecs' | 'internal' | 'other';
  ingressRules: SecurityGroupRule[];
}

/** Result of validating a single security group. */
export interface SecurityGroupValidationResult {
  valid: boolean;
  errors: string[];
}

/** Result of validating all security groups in a stack. */
export interface StackValidationResult {
  valid: boolean;
  results: Record<string, SecurityGroupValidationResult>;
}

/** CIDRs that represent open internet access. */
const OPEN_CIDRS = ['0.0.0.0/0', '::/0'];

/**
 * Checks whether a CIDR represents open internet access (0.0.0.0/0 or ::/0).
 *
 * @param cidr - The CIDR string to check
 * @returns true if the CIDR is open to the internet
 */
export function isOpenCidr(cidr: string): boolean {
  return OPEN_CIDRS.includes(cidr);
}

/**
 * Validates that a security group has no ingress rules allowing traffic
 * from 0.0.0.0/0 or ::/0 on any port.
 *
 * @param config - The security group configuration to validate
 * @returns Validation result with any errors found
 */
export function validateNoOpenIngress(config: SecurityGroupConfig): SecurityGroupValidationResult {
  const errors: string[] = [];

  for (const rule of config.ingressRules) {
    if (isOpenCidr(rule.sourceCidr)) {
      errors.push(
        `Security group "${config.name}" has ingress rule allowing traffic from ${rule.sourceCidr} on port ${rule.port} (${rule.protocol})`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates that an ALB security group only allows inbound traffic
 * on port 443 from a specific (non-open) CIDR range.
 *
 * @param config - The ALB security group configuration to validate
 * @param allowedCidr - The expected allowed CIDR range for the ALB
 * @returns Validation result with any errors found
 */
export function validateAlbIngress(
  config: SecurityGroupConfig,
  allowedCidr: string
): SecurityGroupValidationResult {
  const errors: string[] = [];

  if (config.type !== 'alb') {
    errors.push(`Security group "${config.name}" is not of type "alb"`);
    return { valid: false, errors };
  }

  for (const rule of config.ingressRules) {
    // ALB should only allow port 443
    if (rule.port !== 443) {
      errors.push(
        `ALB security group "${config.name}" allows traffic on port ${rule.port}, only port 443 is permitted`
      );
    }

    // ALB should only allow traffic from the configured CIDR
    if (rule.sourceCidr !== allowedCidr) {
      errors.push(
        `ALB security group "${config.name}" allows traffic from ${rule.sourceCidr}, only ${allowedCidr} is permitted`
      );
    }

    // ALB source CIDR must not be open
    if (isOpenCidr(rule.sourceCidr)) {
      errors.push(
        `ALB security group "${config.name}" allows traffic from open CIDR ${rule.sourceCidr}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates all security groups in a stack configuration.
 * Checks that:
 * 1. No security group has open ingress (0.0.0.0/0 or ::/0)
 * 2. ALB security groups only allow port 443 from the configured CIDR
 *
 * @param securityGroups - Array of security group configurations
 * @param allowedAlbCidr - The allowed CIDR for ALB ingress
 * @returns Stack-level validation result
 */
export function validateStackSecurityGroups(
  securityGroups: SecurityGroupConfig[],
  allowedAlbCidr: string
): StackValidationResult {
  const results: Record<string, SecurityGroupValidationResult> = {};
  let allValid = true;

  for (const sg of securityGroups) {
    // Check no open ingress for all security groups
    const openIngressResult = validateNoOpenIngress(sg);

    if (sg.type === 'alb') {
      // For ALB, also validate port 443 and allowed CIDR
      const albResult = validateAlbIngress(sg, allowedAlbCidr);
      const combinedErrors = Array.from(new Set([...openIngressResult.errors, ...albResult.errors]));
      results[sg.name] = {
        valid: combinedErrors.length === 0,
        errors: combinedErrors,
      };
    } else {
      results[sg.name] = openIngressResult;
    }

    const sgResult = results[sg.name];
    if (sgResult && !sgResult.valid) {
      allValid = false;
    }
  }

  return {
    valid: allValid,
    results,
  };
}
