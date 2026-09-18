import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface CertStackProps extends cdk.StackProps {
  /** Common Name for the self-signed cert (e.g. "*.ambient-demo.local"). */
  commonName: string;
  /** Comma-separated DNS Subject Alternative Names. */
  subjectAltNames: string;
  /** SSM parameter name to publish the resulting ACM certificate ARN to. */
  ssmParameterName: string;
}

/**
 * CertStack — generates a self-signed certificate entirely in the cloud.
 *
 * A custom-resource Lambda (Python + cryptography) generates an RSA key and a
 * self-signed X.509 certificate, imports it into ACM, and returns the ARN. The
 * ARN is published to SSM so deploy.sh (and the OpenEMR + Demo App stacks) can
 * consume it exactly as they consumed the openssl-generated ARN before.
 *
 * This removes the local `openssl` dependency for `--self-signed` deployments:
 * no cert tooling is required on the operator's machine and no private key
 * material ever leaves the Lambda.
 */
export class CertStack extends cdk.Stack {
  public readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    const certFn = new cdk.aws_lambda.Function(this, 'CertGeneratorFn', {
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
      architecture: cdk.aws_lambda.Architecture.X86_64,
      handler: 'handler.handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      code: cdk.aws_lambda.Code.fromAsset('lambda/cert_generator', {
        bundling: {
          image: cdk.aws_lambda.Runtime.PYTHON_3_11.bundlingImage,
          // Force manylinux x86_64 wheels so the native `cryptography` binary
          // matches the Lambda runtime (bundling host may be arm64 macOS).
          command: [
            'bash', '-c',
            'pip install -r requirements.txt ' +
              '--platform manylinux2014_x86_64 --implementation cp ' +
              '--python-version 3.11 --only-binary=:all: --upgrade ' +
              '-t /asset-output && cp -r . /asset-output/',
          ],
        },
      }),
    });

    // The Lambda imports a cert into ACM and (on delete) removes it. Import
    // creates a new ARN so it cannot be scoped to a specific cert ARN; describe/
    // delete are scoped to the account/region ACM certs.
    certFn.addToRolePolicy(new iam.PolicyStatement({
      sid: 'AcmImportSelfSignedCert',
      effect: iam.Effect.ALLOW,
      actions: [
        'acm:ImportCertificate',
        'acm:AddTagsToCertificate',
        'acm:DescribeCertificate',
        'acm:DeleteCertificate',
        'acm:ListTagsForCertificate',
      ],
      resources: ['*'],
    }));

    const provider = new cdk.custom_resources.Provider(this, 'CertProvider', {
      onEventHandler: certFn,
    });

    const cr = new cdk.CustomResource(this, 'SelfSignedCert', {
      serviceToken: provider.serviceToken,
      properties: {
        CommonName: props.commonName,
        SubjectAltNames: props.subjectAltNames,
      },
    });

    this.certificateArn = cr.getAttString('CertificateArn');

    // Publish the ARN to SSM so deploy.sh can read it and pass it to both stacks.
    new ssm.StringParameter(this, 'CertArnParam', {
      parameterName: props.ssmParameterName,
      stringValue: this.certificateArn,
    });

    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificateArn,
      description: 'ARN of the generated self-signed certificate',
    });

    // --- cdk-nag Suppressions ---
    // The cert generator + CDK custom-resource provider are one-time,
    // deployment-only Lambdas (self-signed demo mode). Concurrency/DLQ/VPC
    // controls are not applicable to a synchronous deploy-time custom resource.
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'HIPAA.Security-LambdaConcurrency',
        reason: 'One-time deployment cert-generation custom resource; not traffic-serving.',
      },
      {
        id: 'HIPAA.Security-LambdaDLQ',
        reason: 'One-time deployment custom resource; failures surface directly to deploy.sh / CloudFormation.',
      },
      {
        id: 'HIPAA.Security-LambdaInsideVPC',
        reason: 'Cert generation only calls ACM (no VPC resources); VPC placement is unnecessary.',
      },
      {
        id: 'HIPAA.Security-IAMNoInlinePolicy',
        reason: 'CDK generates inline policies for the Lambda role and the custom-resource provider framework.',
      },
      {
        id: 'HIPAA.Security-IAMPolicyNoStatementsWithFullAccess',
        reason: 'acm:ImportCertificate creates a new ARN and cannot be scoped to a specific certificate; scoped to ACM actions only.',
      },
    ]);
  }
}
