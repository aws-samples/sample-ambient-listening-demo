// Feature: ambient-clinical-documentation-demo, Property 14: Security group ingress validation
import * as fc from 'fast-check';
import {
  isOpenCidr,
  validateNoOpenIngress,
  validateAlbIngress,
  validateStackSecurityGroups,
  SecurityGroupRule,
  SecurityGroupConfig,
} from './security-group-validator';

/**
 * Property 14: Security group ingress validation
 *
 * For any security group created by the CDK stacks, no ingress rule SHALL
 * specify a source CIDR of 0.0.0.0/0 or ::/0 on any port. The ALB security
 * group SHALL only allow inbound traffic on port 443 from the configured
 * IP CIDR range.
 *
 * **Validates: Requirements 13.1, 13.2**
 */
describe('Property 14: Security group ingress validation', () => {
  // --- Arbitraries ---

  /** Generates a valid port number (1-65535). */
  const portArb = fc.integer({ min: 1, max: 65535 });

  /** Generates a protocol string. */
  const protocolArb = fc.constantFrom('tcp', 'udp', 'icmp', '-1');

  /** Generates a non-open CIDR (not 0.0.0.0/0 or ::/0). */
  const nonOpenCidrArb = fc.oneof(
    // Valid IPv4 CIDRs that are not 0.0.0.0/0
    fc.tuple(
      fc.integer({ min: 1, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 32 })
    ).map(([a, b, c, d, mask]) => `${a}.${b}.${c}.${d}/${mask}`),
    // Valid IPv6 CIDRs that are not ::/0
    fc.tuple(
      fc.hexaString({ minLength: 1, maxLength: 4 }),
      fc.integer({ min: 1, max: 128 })
    ).map(([hex, mask]) => `${hex}::/${mask}`)
  );

  /** Generates an open CIDR (0.0.0.0/0 or ::/0). */
  const openCidrArb = fc.constantFrom('0.0.0.0/0', '::/0');

  /** Generates a security group type. */
  const sgTypeArb = fc.constantFrom('alb' as const, 'ecs' as const, 'internal' as const, 'other' as const);

  /** Generates a security group name. */
  const sgNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

  /** Generates a safe ingress rule (non-open CIDR). */
  const safeRuleArb: fc.Arbitrary<SecurityGroupRule> = fc.record({
    port: portArb,
    protocol: protocolArb,
    sourceCidr: nonOpenCidrArb,
  });

  /** Generates an unsafe ingress rule (open CIDR). */
  const unsafeRuleArb: fc.Arbitrary<SecurityGroupRule> = fc.record({
    port: portArb,
    protocol: protocolArb,
    sourceCidr: openCidrArb,
  });

  // --- Property Tests ---

  it('isOpenCidr returns true ONLY for 0.0.0.0/0 and ::/0', () => {
    fc.assert(
      fc.property(fc.string(), (cidr) => {
        const result = isOpenCidr(cidr);
        if (cidr === '0.0.0.0/0' || cidr === '::/0') {
          return result === true;
        } else {
          return result === false;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('validateNoOpenIngress passes for any security group with only non-open CIDRs', () => {
    const safeSgArb: fc.Arbitrary<SecurityGroupConfig> = fc.record({
      name: sgNameArb,
      type: sgTypeArb,
      ingressRules: fc.array(safeRuleArb, { minLength: 0, maxLength: 10 }),
    });

    fc.assert(
      fc.property(safeSgArb, (sg) => {
        const result = validateNoOpenIngress(sg);
        return result.valid === true && result.errors.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  it('validateNoOpenIngress fails for any security group with at least one open CIDR rule', () => {
    const unsafeSgArb: fc.Arbitrary<SecurityGroupConfig> = fc.tuple(
      sgNameArb,
      sgTypeArb,
      fc.array(safeRuleArb, { minLength: 0, maxLength: 5 }),
      fc.array(unsafeRuleArb, { minLength: 1, maxLength: 5 }),
      fc.array(safeRuleArb, { minLength: 0, maxLength: 5 })
    ).map(([name, type, before, unsafe, after]) => ({
      name,
      type,
      ingressRules: [...before, ...unsafe, ...after],
    }));

    fc.assert(
      fc.property(unsafeSgArb, (sg) => {
        const result = validateNoOpenIngress(sg);
        return result.valid === false && result.errors.length > 0;
      }),
      { numRuns: 100 }
    );
  });

  it('ALB security group passes validation when it only allows port 443 from the configured CIDR', () => {
    fc.assert(
      fc.property(sgNameArb, nonOpenCidrArb, (name, allowedCidr) => {
        const sg: SecurityGroupConfig = {
          name,
          type: 'alb',
          ingressRules: [{ port: 443, protocol: 'tcp', sourceCidr: allowedCidr }],
        };
        const result = validateAlbIngress(sg, allowedCidr);
        return result.valid === true && result.errors.length === 0;
      }),
      { numRuns: 100 }
    );
  });

  it('ALB security group fails validation when it allows traffic on a port other than 443', () => {
    const nonHttpsPortArb = fc.integer({ min: 1, max: 65535 }).filter(p => p !== 443);

    fc.assert(
      fc.property(sgNameArb, nonOpenCidrArb, nonHttpsPortArb, (name, allowedCidr, wrongPort) => {
        const sg: SecurityGroupConfig = {
          name,
          type: 'alb',
          ingressRules: [{ port: wrongPort, protocol: 'tcp', sourceCidr: allowedCidr }],
        };
        const result = validateAlbIngress(sg, allowedCidr);
        return result.valid === false && result.errors.some(e => e.includes(`port ${wrongPort}`));
      }),
      { numRuns: 100 }
    );
  });

  it('ALB security group fails validation when it allows traffic from an open CIDR', () => {
    fc.assert(
      fc.property(sgNameArb, nonOpenCidrArb, openCidrArb, (name, allowedCidr, openCidr) => {
        const sg: SecurityGroupConfig = {
          name,
          type: 'alb',
          ingressRules: [{ port: 443, protocol: 'tcp', sourceCidr: openCidr }],
        };
        const result = validateAlbIngress(sg, allowedCidr);
        return result.valid === false && result.errors.length > 0;
      }),
      { numRuns: 100 }
    );
  });

  it('ALB security group fails validation when source CIDR does not match the configured allowed CIDR', () => {
    fc.assert(
      fc.property(
        sgNameArb,
        nonOpenCidrArb,
        nonOpenCidrArb,
        (name, allowedCidr, differentCidr) => {
          // Ensure the CIDRs are actually different
          fc.pre(allowedCidr !== differentCidr);

          const sg: SecurityGroupConfig = {
            name,
            type: 'alb',
            ingressRules: [{ port: 443, protocol: 'tcp', sourceCidr: differentCidr }],
          };
          const result = validateAlbIngress(sg, allowedCidr);
          return result.valid === false && result.errors.some(e => e.includes(differentCidr));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validateStackSecurityGroups rejects any stack containing a security group with open ingress', () => {
    fc.assert(
      fc.property(
        nonOpenCidrArb,
        sgNameArb,
        fc.array(safeRuleArb, { minLength: 0, maxLength: 3 }),
        unsafeRuleArb,
        (allowedCidr, name, safeRules, unsafeRule) => {
          const securityGroups: SecurityGroupConfig[] = [
            {
              name: 'demo-alb-sg',
              type: 'alb',
              ingressRules: [{ port: 443, protocol: 'tcp', sourceCidr: allowedCidr }],
            },
            {
              name,
              type: 'ecs',
              ingressRules: [...safeRules, unsafeRule],
            },
          ];

          const result = validateStackSecurityGroups(securityGroups, allowedCidr);
          return result.valid === false;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validateStackSecurityGroups passes when all security groups have restricted ingress and ALB only allows port 443 from configured CIDR', () => {
    fc.assert(
      fc.property(
        nonOpenCidrArb,
        fc.array(safeRuleArb, { minLength: 0, maxLength: 5 }),
        fc.array(safeRuleArb, { minLength: 0, maxLength: 5 }),
        (allowedCidr, ecsRules, internalRules) => {
          const securityGroups: SecurityGroupConfig[] = [
            {
              name: 'demo-alb-sg',
              type: 'alb',
              ingressRules: [{ port: 443, protocol: 'tcp', sourceCidr: allowedCidr }],
            },
            {
              name: 'demo-ecs-sg',
              type: 'ecs',
              ingressRules: ecsRules,
            },
            {
              name: 'openemr-internal-sg',
              type: 'internal',
              ingressRules: internalRules,
            },
          ];

          const result = validateStackSecurityGroups(securityGroups, allowedCidr);
          return result.valid === true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
