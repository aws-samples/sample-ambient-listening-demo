#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { HIPAASecurityChecks } from 'cdk-nag';
import { DemoAppStack } from '../lib/demo-app-stack';

const SUPPORTED_REGIONS = ['us-east-1', 'us-west-2'];

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Region validation at synth time
const targetRegion = env.region ?? process.env.AWS_DEFAULT_REGION ?? '';
if (targetRegion && !SUPPORTED_REGIONS.includes(targetRegion)) {
  throw new Error(
    `Unsupported region: "${targetRegion}". ` +
    `The Demo App stack can only be deployed to: ${SUPPORTED_REGIONS.join(', ')}.`
  );
}

const openemrStackName = app.node.tryGetContext('openemrStackName') ?? 'OpenEMRStack';
const allowedCidr = app.node.tryGetContext('allowedCidr') ?? '10.0.0.0/8';

new DemoAppStack(app, 'DemoAppStack', {
  env,
  openemrStackName,
  allowedCidr,
  description: 'Ambient Clinical Documentation Demo Application Stack',
});

// --- cdk-nag HIPAA Security Checks ---
// Enable HIPAA Security rule pack on the entire CDK app.
// Deployment (cdk synth) will fail if there are unresolved HIPAA findings.
// Suppressions with documented justifications are applied in the stack definition.
Aspects.of(app).add(new HIPAASecurityChecks({ verbose: true }));

// NOTE: The OpenEMR submodule (submodules/openemr/) already includes its own cdk-nag
// checks with both AwsSolutionsChecks and HIPAASecurityChecks enabled in app.py.
// See submodules/openemr/app.py for details.
