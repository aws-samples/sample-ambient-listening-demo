#!/usr/bin/env ts-node
/**
 * Compatibility verification script for the OpenEMR CDK submodule.
 *
 * Runs `cdk synth` on the OpenEMR submodule and verifies that the synthesized
 * CloudFormation template contains the expected stack output keys required by
 * the Ambient Clinical Documentation Demo.
 *
 * Expected outputs:
 *   - ApplicationURL        (OpenEMR web console / FHIR API base URL)
 *   - DatabaseSecretARN     (Aurora database credentials secret)
 *   - OpenEMRPasswordSecretARN (OpenEMR admin credentials secret)
 *
 * Exit codes:
 *   0 — All checks passed
 *   1 — cdk synth failed or expected output keys are missing
 *
 * Validates: Requirements 12.3, 12.4
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SUBMODULE_DIR = path.resolve(__dirname, '..', 'infrastructure', 'openemr');
const CDK_OUT_DIR = path.join(SUBMODULE_DIR, 'cdk.out');

/**
 * Expected CloudFormation output keys that the demo application depends on.
 * These map to the integration points defined in the design document:
 *   - FHIR API base URL (derived from ApplicationURL)
 *   - OpenEMR web console URL (ApplicationURL)
 *   - Credentials secret ARN (DatabaseSecretARN + OpenEMRPasswordSecretARN)
 */
const EXPECTED_OUTPUT_KEYS: { key: string; description: string }[] = [
  { key: 'ApplicationURL', description: 'OpenEMR web console URL / FHIR API base URL' },
  { key: 'DatabaseSecretARN', description: 'Aurora database credentials secret ARN' },
  { key: 'OpenEMRPasswordSecretARN', description: 'OpenEMR admin password secret ARN' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printError(message: string): void {
  console.error(`\n❌ ERROR: ${message}\n`);
}

function printSuccess(message: string): void {
  console.log(`\n✅ ${message}\n`);
}

function printInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}


// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

function checkSubmoduleInitialized(): boolean {
  if (!fs.existsSync(SUBMODULE_DIR)) {
    printError(
      `OpenEMR submodule directory not found at: ${SUBMODULE_DIR}\n` +
      `  Run: git submodule update --init --recursive`
    );
    return false;
  }

  // Check for app.py as a signal that the submodule content is present
  const appPy = path.join(SUBMODULE_DIR, 'app.py');
  if (!fs.existsSync(appPy)) {
    printError(
      `OpenEMR submodule appears uninitialized (app.py not found).\n` +
      `  Run: git submodule update --init --recursive`
    );
    return false;
  }

  return true;
}

function checkCdkInstalled(): boolean {
  try {
    execSync('cdk --version', { stdio: 'pipe' });
    return true;
  } catch {
    printError(
      `AWS CDK CLI is not installed or not in PATH.\n` +
      `  Install with: npm install -g aws-cdk`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// CDK Synth
// ---------------------------------------------------------------------------

function runCdkSynth(): boolean {
  printInfo('Running cdk synth on OpenEMR submodule...');

  try {
    execSync('cdk synth --quiet 2>&1', {
      cwd: SUBMODULE_DIR,
      stdio: 'pipe',
      env: {
        ...process.env,
        // Provide dummy account/region for synth (no actual deployment)
        CDK_DEFAULT_ACCOUNT: process.env['CDK_DEFAULT_ACCOUNT'] || '123456789012',
        CDK_DEFAULT_REGION: process.env['CDK_DEFAULT_REGION'] || 'us-east-1',
      },
    });
    return true;
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    const output = stderr || stdout || error.message || 'Unknown error';

    printError(
      `cdk synth failed for the OpenEMR submodule.\n\n` +
      `  Working directory: ${SUBMODULE_DIR}\n` +
      `  Output:\n${indent(output, '    ')}`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Template verification
// ---------------------------------------------------------------------------

interface CloudFormationTemplate {
  Outputs?: Record<string, { Value: unknown; Description?: string }>;
}

function findTemplate(): string | null {
  // cdk synth outputs to cdk.out/ directory
  if (!fs.existsSync(CDK_OUT_DIR)) {
    return null;
  }

  // Look for the synthesized template (typically OpenemrEcsStack.template.json)
  const files = fs.readdirSync(CDK_OUT_DIR);
  const templateFile = files.find(
    (f) => f.endsWith('.template.json') && !f.startsWith('Tree')
  );

  if (!templateFile) {
    return null;
  }

  return path.join(CDK_OUT_DIR, templateFile);
}

function verifyOutputKeys(): { passed: boolean; missing: string[] } {
  const templatePath = findTemplate();

  if (!templatePath) {
    printError(
      `Could not find synthesized CloudFormation template in: ${CDK_OUT_DIR}\n` +
      `  Expected a .template.json file after cdk synth.`
    );
    return { passed: false, missing: EXPECTED_OUTPUT_KEYS.map((k) => k.key) };
  }

  printInfo(`Checking template: ${path.basename(templatePath)}`);

  let template: CloudFormationTemplate;
  try {
    const content = fs.readFileSync(templatePath, 'utf-8');
    template = JSON.parse(content) as CloudFormationTemplate;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    printError(`Failed to parse CloudFormation template: ${message}`);
    return { passed: false, missing: EXPECTED_OUTPUT_KEYS.map((k) => k.key) };
  }

  const outputs = template.Outputs || {};
  // CloudFormation output logical IDs in CDK are typically the construct ID
  // but may have additional suffixes. We check if any output key contains our expected key.
  const outputKeys = Object.keys(outputs);

  const missing: string[] = [];

  for (const expected of EXPECTED_OUTPUT_KEYS) {
    const found = outputKeys.some(
      (key) => key.includes(expected.key) || key === expected.key
    );
    if (found) {
      printInfo(`  ✓ Found output: ${expected.key} (${expected.description})`);
    } else {
      missing.push(`${expected.key} — ${expected.description}`);
    }
  }

  return { passed: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       OpenEMR Submodule Compatibility Verification          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Pre-flight checks
  if (!checkSubmoduleInitialized()) {
    process.exit(1);
  }

  if (!checkCdkInstalled()) {
    process.exit(1);
  }

  // Run cdk synth
  if (!runCdkSynth()) {
    process.exit(1);
  }

  // Verify output keys
  const { passed, missing } = verifyOutputKeys();

  if (!passed) {
    printError(
      `Missing expected stack output keys:\n` +
      missing.map((m) => `  • ${m}`).join('\n') + '\n\n' +
      `  The OpenEMR CDK stack must expose these outputs for the demo application\n` +
      `  to integrate correctly. Check the stack definition in:\n` +
      `  ${path.join(SUBMODULE_DIR, 'openemr_ecs', 'stack.py')}`
    );
    process.exit(1);
  }

  printSuccess(
    'All expected output keys are present in the synthesized template.\n' +
    '  The OpenEMR submodule is compatible with the Ambient Clinical Documentation Demo.'
  );
  process.exit(0);
}

main();
