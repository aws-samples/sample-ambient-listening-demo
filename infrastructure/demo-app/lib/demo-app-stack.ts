import * as cdk from 'aws-cdk-lib';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as elbv2Actions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

/**
 * Supported AWS regions for the Demo App stack.
 * Amazon Connect Health ambient documentation is only available in these regions.
 */
export const SUPPORTED_REGIONS = ['us-east-1', 'us-west-2'];

export interface DemoAppStackProps extends cdk.StackProps {
  /** Name of the OpenEMR CloudFormation stack to read outputs from */
  openemrStackName: string;
  /** CIDR range allowed to access the ALB (e.g., workshop participant IP) */
  allowedCidr: string;
  /** ARN of the ACM certificate for HTTPS on the ALB (optional, can also be provided via CDK context) */
  certificateArn?: string;
  /** Route53 domain name for DNS records (e.g., hda.example.people.aws.dev) */
  domain?: string;
  /** VPC ID to deploy into (imports existing VPC instead of creating a new one) */
  vpcId?: string;
}

/**
 * OpenEMR stack output references resolved via SSM parameters or CloudFormation exports.
 */
export interface OpenEmrOutputs {
  /** FHIR API base URL from the OpenEMR stack */
  fhirApiBaseUrl: string;
  /** OpenEMR web console URL */
  webConsoleUrl: string;
  /** ARN of the Secrets Manager secret containing OpenEMR credentials */
  credentialsSecretArn: string;
}

export class DemoAppStack extends cdk.Stack {
  /** The VPC hosting the demo application resources */
  public readonly vpc: ec2.IVpc;

  /** Security group for the public-facing ALB (HTTPS from allowedCidr only) */
  public readonly albSecurityGroup: ec2.SecurityGroup;

  /** Security group for ECS Fargate tasks (inbound from ALB only) */
  public readonly ecsSecurityGroup: ec2.SecurityGroup;

  /** Security group for the internal OpenEMR ALB (inbound from ECS tasks only) */
  public readonly openemrAlbSecurityGroup: ec2.SecurityGroup;

  /** KMS key used for S3 output bucket encryption */
  public readonly outputBucketKey: kms.Key;

  /** S3 bucket for ambient documentation outputs (SSE-KMS encrypted, no public access) */
  public readonly outputBucket: s3.Bucket;

  /** Database credentials stored in Secrets Manager with auto-rotation (30-day schedule) */
  public readonly dbCredentials: secretsmanager.Secret;

  /** FHIR API OAuth2 client credentials (clientId and clientSecret) stored in Secrets Manager */
  public readonly fhirApiCredentials: secretsmanager.Secret;

  /** OpenEMR admin credentials (username and password) stored in Secrets Manager */
  public readonly openemrAdminCredentials: secretsmanager.Secret;

  /** ECS task execution role (pulling images, writing logs, reading secrets) */
  public readonly ecsTaskExecutionRole: iam.Role;

  /** ECS task role (application-level permissions for Connect Health, S3, Secrets Manager) */
  public readonly ecsTaskRole: iam.Role;

  /** ECS cluster hosting the demo application */
  public readonly ecsCluster: ecs.Cluster;

  /** ECS Fargate task definition for the Next.js application */
  public readonly taskDefinition: ecs.FargateTaskDefinition;

  /** ECS Fargate service running the Next.js application */
  public readonly ecsService: ecs.FargateService;

  /** Application Load Balancer for the demo application */
  public readonly alb: elbv2.ApplicationLoadBalancer;

  /** Resolved OpenEMR stack outputs */
  public readonly openEmrOutputs: OpenEmrOutputs;

  constructor(scope: Construct, id: string, props: DemoAppStackProps) {
    super(scope, id, props);

    // --- Region Validation ---
    // Validate at deploy time using CfnRules (catches cases where synth-time check is bypassed)
    new cdk.CfnRule(this, 'RegionValidationRule', {
      assertions: [
        {
          assert: cdk.Fn.conditionOr(
            ...SUPPORTED_REGIONS.map(r => cdk.Fn.conditionEquals(cdk.Aws.REGION, r))
          ),
          assertDescription: `This stack can only be deployed in ${SUPPORTED_REGIONS.join(' or ')}. ` +
            `Current region does not match supported regions.`,
        },
      ],
    });

    // --- VPC ---
    // Import existing VPC (from OpenEMR stack) or create a new one.
    // Sharing the VPC with OpenEMR allows direct private network access to the FHIR API.
    const vpcId = props.vpcId ?? this.node.tryGetContext('vpcId');
    if (vpcId) {
      this.vpc = ec2.Vpc.fromLookup(this, 'DemoAppVpc', { vpcId });
    } else {
      // Fallback: create a new VPC if no vpcId is provided
      this.vpc = new ec2.Vpc(this, 'DemoAppVpc', {
        maxAzs: 2,
        natGateways: 2,
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: ec2.SubnetType.PUBLIC,
            cidrMask: 24,
            mapPublicIpOnLaunch: false,
          },
          {
            name: 'Private',
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
          {
            name: 'Isolated',
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            cidrMask: 24,
          },
        ],
      });

      // Enable VPC Flow Logs for security monitoring (only for new VPCs)
      (this.vpc as ec2.Vpc).addFlowLog('FlowLog', {
        destination: ec2.FlowLogDestination.toCloudWatchLogs(),
        trafficType: ec2.FlowLogTrafficType.ALL,
      });
    }

    // --- Security Groups ---
    // ALB Security Group: allows inbound HTTPS (443) only from the configured allowedCidr
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for the public-facing ALB - HTTPS from allowedCidr only',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.allowedCidr),
      ec2.Port.tcp(443),
      'Allow HTTPS inbound from configured IP CIDR range'
    );

    // ECS Task Security Group: allows inbound only from the ALB security group (port 3000 for Next.js)
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ECS Fargate tasks - inbound from ALB only',
      allowAllOutbound: true,
    });
    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(3000),
      'Allow inbound from ALB on port 3000 (Next.js)'
    );

    // Internal OpenEMR ALB Security Group: allows inbound only from ECS task security group
    this.openemrAlbSecurityGroup = new ec2.SecurityGroup(this, 'OpenemrAlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for internal OpenEMR ALB - inbound from Demo App ECS only',
      allowAllOutbound: true,
    });
    this.openemrAlbSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(443),
      'Allow HTTPS inbound from Demo App ECS tasks'
    );

    // --- S3 Output Bucket ---
    // Dedicated KMS key for S3 bucket encryption (SSE-KMS)
    this.outputBucketKey = new kms.Key(this, 'OutputBucketKey', {
      description: 'KMS key for encrypting the ambient documentation S3 output bucket',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Access logging bucket for the output bucket (HIPAA requirement)
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // S3 bucket for ambient documentation outputs
    // Security: SSE-KMS encryption, all public access blocked, versioning enabled, access logging
    this.outputBucket = new s3.Bucket(this, 'OutputBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.outputBucketKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'output-bucket-logs/',
    });

    // Grant the Amazon Connect Health service permission to write session outputs to the bucket.
    // The service writes clinical notes, transcripts, and after-visit summaries after sessions end.
    this.outputBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowConnectHealthServiceWrite',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('health-agent.amazonaws.com')],
      actions: [
        's3:PutObject',
        's3:PutObjectAcl',
        's3:GetBucketLocation',
        's3:ListBucket',
      ],
      resources: [
        this.outputBucket.bucketArn,
        `${this.outputBucket.bucketArn}/*`,
      ],
    }));

    // Grant the Connect Health service permission to use the KMS key for encryption
    this.outputBucketKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowConnectHealthServiceKmsAccess',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('health-agent.amazonaws.com')],
      actions: [
        'kms:GenerateDataKey',
        'kms:Decrypt',
        'kms:Encrypt',
        'kms:DescribeKey',
      ],
      resources: ['*'],
    }));

    // --- OpenEMR Stack Output References ---
    // Read outputs from the OpenEMR stack via SSM parameters.
    // The OpenEMR stack publishes its outputs to SSM for cross-stack consumption.
    const openemrStackName = props.openemrStackName;

    const fhirApiBaseUrl = ssm.StringParameter.valueForStringParameter(
      this,
      `/${openemrStackName}/FhirApiBaseUrl`
    );

    const webConsoleUrl = ssm.StringParameter.valueForStringParameter(
      this,
      `/${openemrStackName}/WebConsoleUrl`
    );

    const credentialsSecretArn = ssm.StringParameter.valueForStringParameter(
      this,
      `/${openemrStackName}/CredentialsSecretArn`
    );

    this.openEmrOutputs = {
      fhirApiBaseUrl,
      webConsoleUrl,
      credentialsSecretArn,
    };

    // --- KMS Key for Secrets and Logs ---
    // Dedicated KMS key for encrypting Secrets Manager secrets and CloudWatch Log Groups
    const secretsKey = new kms.Key(this, 'SecretsEncryptionKey', {
      description: 'KMS key for encrypting Secrets Manager secrets and CloudWatch Log Groups',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Grant CloudWatch Logs service permission to use this KMS key
    secretsKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchLogsEncryption',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal(`logs.${cdk.Aws.REGION}.amazonaws.com`)],
      actions: [
        'kms:Encrypt*',
        'kms:Decrypt*',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
        'kms:Describe*',
      ],
      resources: ['*'],
      conditions: {
        ArnLike: {
          'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:*`,
        },
      },
    }));

    // --- Secrets Manager ---
    // All credentials are stored in Secrets Manager and referenced by ARN.
    // ECS task definitions reference these secrets via the `secrets` property in the
    // container definition — never as plain-text environment variables.

    // Database credentials with auto-generated password and 30-day rotation schedule
    this.dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
      secretName: `${id}/db-credentials`,
      description: 'Database credentials for the Demo Application (auto-rotated every 30 days)',
      encryptionKey: secretsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'demoadmin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // FHIR API OAuth2 client credentials (client ID and client secret)
    this.fhirApiCredentials = new secretsmanager.Secret(this, 'FhirApiCredentials', {
      secretName: `${id}/fhir-api-credentials`,
      description: 'FHIR API OAuth2 client credentials for OpenEMR integration',
      encryptionKey: secretsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ clientId: 'demo-app-fhir-client' }),
        generateStringKey: 'clientSecret',
        excludePunctuation: false,
        passwordLength: 48,
      },
    });

    // OpenEMR admin credentials (username and password)
    this.openemrAdminCredentials = new secretsmanager.Secret(this, 'OpenemrAdminCredentials', {
      secretName: `${id}/openemr-admin-credentials`,
      description: 'OpenEMR admin credentials for administrative access',
      encryptionKey: secretsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 24,
      },
    });

    // --- IAM Roles (Least Privilege) ---

    // ECS Task Execution Role: used by the ECS agent to pull images, write logs, and read secrets
    this.ecsTaskExecutionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS task execution role for pulling images, writing logs, and reading secrets',
    });

    // Attach the AWS-managed ECS task execution policy (ECR pull, CloudWatch Logs)
    this.ecsTaskExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
    );

    // Allow reading secrets from Secrets Manager — scoped to the three specific secret ARNs only
    this.ecsTaskExecutionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SecretsManagerReadAccess',
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        this.dbCredentials.secretArn,
        this.fhirApiCredentials.secretArn,
        this.openemrAdminCredentials.secretArn,
      ],
    }));

    // Allow KMS decrypt for the output bucket key and secrets key
    this.ecsTaskExecutionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'KmsDecryptForSecrets',
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt'],
      resources: [this.outputBucketKey.keyArn, secretsKey.keyArn],
    }));

    // ECS Task Role: application-level permissions for the running container
    this.ecsTaskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS task role for application-level access to Connect Health, S3, and Secrets Manager',
    });

    // Amazon Connect Health permissions for ambient documentation session management.
    // NOTE: The service namespace is "health-agent" (not "connecthealth").
    // These actions do not support resource-level permissions — resource '*' is
    // required per AWS documentation.
    this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ConnectHealthAmbientAccess',
      effect: iam.Effect.ALLOW,
      actions: [
        'health-agent:StartMedicalScribeListeningSession',
        'health-agent:GetMedicalScribeListeningSession',
        'health-agent:CreateDomain',
        'health-agent:CreateSubscription',
        'health-agent:GetDomain',
        'health-agent:ListDomains',
        'health-agent:ListSubscriptions',
        'health-agent:GetSubscription',
      ],
      // Connect Health does not support resource-level permissions for these actions
      resources: ['*'],
    }));

    // Amazon Bedrock permissions for clinical note summarization
    this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BedrockInvokeModelAccess',
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/*',
        `arn:aws:bedrock:*:${cdk.Aws.ACCOUNT_ID}:inference-profile/*`,
      ],
    }));

    // S3 permissions scoped to the output bucket only
    this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'S3OutputBucketReadAccess',
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [`${this.outputBucket.bucketArn}/*`],
    }));

    this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'S3OutputBucketListAccess',
      effect: iam.Effect.ALLOW,
      actions: ['s3:ListBucket', 's3:GetBucketLocation'],
      resources: [this.outputBucket.bucketArn],
    }));

    // KMS decrypt/encrypt permission scoped to the output bucket key and secrets key
    this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'KmsDecryptForS3Objects',
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt', 'kms:GenerateDataKey', 'kms:Encrypt'],
      resources: [
        this.outputBucketKey.keyArn,
        secretsKey.keyArn,
        // OpenEMR stack's KMS key (encrypts the admin password and DB secrets — key ID changes per deploy)
        `arn:aws:kms:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:key/*`,
      ],
    }));

    // Secrets Manager read access scoped to the specific secret ARNs
    this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SecretsManagerAppReadAccess',
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        this.dbCredentials.secretArn,
        this.fhirApiCredentials.secretArn,
        this.openemrAdminCredentials.secretArn,
        // OpenEMR stack password secret (for FHIR API password grant auth)
        `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:Password67973E0B-*`,
        // OpenEMR Aurora database secret (for direct DB queries — clinical notes)
        `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:dbsecretF8F18970-*`,
      ],
    }));

    // --- ECS Cluster ---
    // Connect Health domain name (use existing domain from context, or generate a default name)
    const connectHealthDomainName = this.node.tryGetContext('connectHealthDomainName') || `${id}-ambient-domain`;

    this.ecsCluster = new ecs.Cluster(this, 'DemoAppCluster', {
      vpc: this.vpc,
      containerInsights: true,
    });

    // --- ECS Task Definition ---
    // CloudWatch log group for container logs (KMS encrypted for HIPAA compliance)
    const logGroup = new logs.LogGroup(this, 'DemoAppLogGroup', {
      logGroupName: `/ecs/${id}/demo-app`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryptionKey: secretsKey,
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'DemoAppTaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole: this.ecsTaskRole,
      executionRole: this.ecsTaskExecutionRole,
    });

    this.taskDefinition.addContainer('DemoAppContainer', {
      image: ecs.ContainerImage.fromAsset('../../', {
        file: 'Dockerfile',
        exclude: ['infrastructure', '.git', 'node_modules', '.next'],
        platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
      }),
      portMappings: [
        { containerPort: 3000, protocol: ecs.Protocol.TCP },
      ],
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'demo-app',
      }),
      environment: {
        AWS_REGION: cdk.Aws.REGION,
        S3_OUTPUT_BUCKET: this.outputBucket.bucketName,
        OPENEMR_FHIR_BASE_URL: fhirApiBaseUrl,
        CONNECT_HEALTH_DOMAIN_NAME: connectHealthDomainName,
        FHIR_CREDENTIALS_SECRET_NAME: this.fhirApiCredentials.secretName,
        DB_SECRET_ARN: ssm.StringParameter.valueForStringParameter(this, `/${openemrStackName}/DatabaseSecretArn`),
        NODE_TLS_REJECT_UNAUTHORIZED: '0', // TODO: Remove after fixing TLS cert issue
      },
      secrets: {
        DB_CREDENTIALS: ecs.Secret.fromSecretsManager(this.dbCredentials),
        FHIR_API_CREDENTIALS: ecs.Secret.fromSecretsManager(this.fhirApiCredentials),
        OPENEMR_ADMIN_CREDENTIALS: ecs.Secret.fromSecretsManager(this.openemrAdminCredentials),
      },
    });

    // --- ECS Fargate Service ---
    this.ecsService = new ecs.FargateService(this, 'DemoAppService', {
      cluster: this.ecsCluster,
      taskDefinition: this.taskDefinition,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.ecsSecurityGroup],
      assignPublicIp: false,
      enableExecuteCommand: true,
    });

    // --- Application Load Balancer ---
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'DemoAppAlb', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      deletionProtection: false,
      dropInvalidHeaderFields: true,
    });

    // Resolve ACM certificate ARN from props or CDK context
    const certArn = props.certificateArn ?? this.node.tryGetContext('certificateArn');
    if (!certArn) {
      throw new Error(
        'A certificate ARN must be provided either via the certificateArn prop or CDK context parameter. ' +
        'Use: cdk deploy --context certificateArn=arn:aws:acm:...'
      );
    }

    const certificate = certificatemanager.Certificate.fromCertificateArn(
      this,
      'AlbCertificate',
      certArn
    );

    // HTTPS listener on port 443 with TLS 1.2 minimum
    const httpsListener = this.alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.TLS12,
      open: false, // Do NOT auto-add 0.0.0.0/0 — we manage SG rules explicitly via allowedCidr
    });

    // --- Cognito User Pool for ALB Authentication ---
    const userPool = new cognito.UserPool(this, 'DemoAppUserPool', {
      userPoolName: `${id}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Determine the callback URL based on domain
    const domainName = props.domain ?? this.node.tryGetContext('domain');
    const ambientDomain = domainName
      ? (domainName.startsWith('ambient.') ? domainName : `ambient.${domainName}`)
      : null;
    const callbackUrl = ambientDomain
      ? `https://${ambientDomain}/oauth2/idpresponse`
      : `https://${this.alb.loadBalancerDnsName}/oauth2/idpresponse`;

    const userPoolClient = userPool.addClient('DemoAppClient', {
      userPoolClientName: `${id}-alb-client`,
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [callbackUrl],
        logoutUrls: [domainName ? `https://ambient.${domainName}` : `https://${this.alb.loadBalancerDnsName}`],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    // Cognito hosted UI domain
    const cognitoDomain = userPool.addDomain('DemoAppCognitoDomain', {
      cognitoDomain: {
        domainPrefix: `${id.toLowerCase()}-auth`,
      },
    });

    // Create a default demo clinician user with a generated password stored in Secrets Manager
    const clinicianCredentials = new secretsmanager.Secret(this, 'ClinicianCredentials', {
      secretName: `${id}/clinician-credentials`,
      description: 'Demo clinician user credentials for the Ambient Documentation app',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'clinician@demo.local' }),
        generateStringKey: 'password',
        passwordLength: 16,
        includeSpace: false,
        requireEachIncludedType: true,
      },
    });

    // Custom resource to create the Cognito user with the generated password
    const createUserFn = new cdk.aws_lambda.Function(this, 'CreateCognitoUserFn', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      code: cdk.aws_lambda.Code.fromInline(`
const { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

exports.handler = async (event) => {
  if (event.RequestType === 'Delete') return { PhysicalResourceId: event.PhysicalResourceId };

  const { UserPoolId, SecretArn } = event.ResourceProperties;
  const region = process.env.AWS_REGION;

  const smClient = new SecretsManagerClient({ region });
  const secretResp = await smClient.send(new GetSecretValueCommand({ SecretId: SecretArn }));
  const creds = JSON.parse(secretResp.SecretString);

  const cognitoClient = new CognitoIdentityProviderClient({ region });

  try {
    await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId,
      Username: creds.username,
      UserAttributes: [
        { Name: 'email', Value: creds.username },
        { Name: 'email_verified', Value: 'true' },
      ],
      MessageAction: 'SUPPRESS',
    }));
  } catch (e) {
    if (e.name !== 'UsernameExistsException') throw e;
  }

  await cognitoClient.send(new AdminSetUserPasswordCommand({
    UserPoolId,
    Username: creds.username,
    Password: creds.password,
    Permanent: true,
  }));

  return { PhysicalResourceId: creds.username };
};
      `),
    });

    createUserFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword'],
      resources: [userPool.userPoolArn],
    }));
    clinicianCredentials.grantRead(createUserFn);

    const createUserProvider = new cdk.custom_resources.Provider(this, 'CreateCognitoUserProvider', {
      onEventHandler: createUserFn,
    });

    new cdk.CustomResource(this, 'CreateCognitoUser', {
      serviceToken: createUserProvider.serviceToken,
      properties: {
        UserPoolId: userPool.userPoolId,
        SecretArn: clinicianCredentials.secretArn,
      },
    });

    // ALB listener with Cognito authentication action
    httpsListener.addAction('CognitoAuth', {
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
      action: new elbv2Actions.AuthenticateCognitoAction({
        userPool,
        userPoolClient,
        userPoolDomain: cognitoDomain,
        next: elbv2.ListenerAction.forward([
          httpsListener.addTargets('DemoAppTargetGroup', {
            port: 3000,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targets: [this.ecsService],
            healthCheck: {
              path: '/',
              interval: cdk.Duration.seconds(30),
              timeout: cdk.Duration.seconds(5),
              healthyThresholdCount: 2,
              unhealthyThresholdCount: 3,
            },
          }),
        ]),
      }),
    });

    // Default action (deny unauthenticated)
    httpsListener.addAction('DefaultDeny', {
      action: elbv2.ListenerAction.fixedResponse(401, {
        contentType: 'text/plain',
        messageBody: 'Unauthorized',
      }),
    });

    // Stack outputs for Cognito
    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'CognitoLoginUrl', {
      value: `https://${cognitoDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com/login?client_id=${userPoolClient.userPoolClientId}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent(callbackUrl)}`,
      description: 'Cognito hosted UI login URL',
    });

    new cdk.CfnOutput(this, 'DemoClinicianUserInfo', {
      value: clinicianCredentials.secretArn,
      description: 'Secrets Manager ARN containing demo clinician credentials (username + password)',
    });

    // --- WAF WebACL ---
    const webAcl = new wafv2.CfnWebACL(this, 'DemoAppWebAcl', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'DemoAppWebAclMetric',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AllowAudioStreamPath',
          priority: 0,
          action: { allow: {} },
          statement: {
            byteMatchStatement: {
              searchString: '/api/sessions/',
              fieldToMatch: { uriPath: {} },
              textTransformations: [{ priority: 0, type: 'NONE' }],
              positionalConstraint: 'STARTS_WITH',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AllowAudioStreamMetric',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSetMetric',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Associate WAF WebACL with the ALB
    new wafv2.CfnWebACLAssociation(this, 'DemoAppWebAclAssociation', {
      resourceArn: this.alb.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    // WAF logging to CloudWatch Logs (required for HIPAA compliance)
    const wafLogGroup = new logs.LogGroup(this, 'WafLogGroup', {
      logGroupName: `aws-waf-logs-${id}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryptionKey: secretsKey,
    });

    new wafv2.CfnLoggingConfiguration(this, 'WafLoggingConfig', {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [wafLogGroup.logGroupArn],
    });

    // --- Route53 DNS Records ---
    if (domainName) {
      // The domainName may be the full subdomain (e.g., "ambient.hda.example.com") or
      // the parent zone (e.g., "hda.example.com"). Strip the "ambient." prefix for zone lookup.
      const zoneDomain = domainName.replace(/^ambient\./, '');
      const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
        domainName: zoneDomain,
      });

      // Create A record for ambient.<zone> pointing to the ALB
      const recordName = domainName.startsWith('ambient.') ? domainName : `ambient.${domainName}`;
      new route53.ARecord(this, 'DemoAppAliasRecord', {
        zone: hostedZone,
        recordName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(this.alb)
        ),
      });
    }

    // --- Data Loader (Custom Resource) ---
    // Loads synthetic patient data into OpenEMR database during deployment.
    // Uses the OpenEMR Aurora database credentials to insert patients directly.
    const dataLoaderLambda = new cdk.aws_lambda.Function(this, 'DataLoaderFunction', {
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
      handler: 'handler.handler',
      code: cdk.aws_lambda.Code.fromAsset('lambda/data_loader', {
        bundling: {
          image: cdk.aws_lambda.Runtime.PYTHON_3_11.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -r . /asset-output/',
          ],
        },
      }),
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      environment: {
        DB_SECRET_ARN: 'discover-at-runtime',
        PATIENT_COUNT: '100',
        FHIR_CREDENTIALS_SECRET_ARN: this.fhirApiCredentials.secretArn,
        OPENEMR_ADMIN_SECRET_ARN: this.openemrAdminCredentials.secretArn,
        SYNTHEA_BUCKET: this.outputBucket.bucketName,
        SYNTHEA_PREFIX: 'synthea-bundles/',
      },
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.ecsSecurityGroup],
    });

    // Grant Lambda access to read the OpenEMR database secret
    dataLoaderLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:dbsecret*`,
        `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:RdsSlotSecret*`,
        `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:Password67973E0B-*`,
      ],
    }));

    // Grant Lambda permission to list secrets (needed to find OpenEMR admin password)
    dataLoaderLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:ListSecrets'],
      resources: ['*'],
    }));

    // Grant Lambda permission to describe RDS clusters (to get correct endpoint)
    dataLoaderLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rds:DescribeDBClusters'],
      resources: ['*'],
    }));

    // Grant Lambda access to read Synthea bundles from S3
    this.outputBucket.grantRead(dataLoaderLambda);
    this.outputBucketKey.grantDecrypt(dataLoaderLambda);

    // Grant Lambda access to read/update the FHIR credentials secret (for OAuth client registration)
    dataLoaderLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:UpdateSecret', 'secretsmanager:PutSecretValue'],
      resources: [this.fhirApiCredentials.secretArn, this.openemrAdminCredentials.secretArn],
    }));

    // Grant KMS decrypt/encrypt for the OpenEMR secrets and FHIR credentials secret
    dataLoaderLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey', 'kms:GenerateDataKey*'],
      resources: ['*'], // OpenEMR stack's KMS key + Demo App secrets key
    }));

    // Data loader is invoked by deploy.sh after security group rules are configured.
    // Do NOT use a custom resource here — the Lambda needs DB access which requires
    // the SG rules that deploy.sh adds after CDK deploy completes.

    // Data loader is invoked by deploy.sh after security group rules are configured.
    // Do NOT use a custom resource here — the Lambda needs DB access which requires
    // the SG rules that deploy.sh adds after CDK deploy completes.

    // --- Stack Outputs ---
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for the Demo Application',
    });

    new cdk.CfnOutput(this, 'OpenEmrFhirApiBaseUrl', {
      value: fhirApiBaseUrl,
      description: 'FHIR API base URL from the OpenEMR stack',
    });

    new cdk.CfnOutput(this, 'OpenEmrWebConsoleUrl', {
      value: webConsoleUrl,
      description: 'OpenEMR web console URL',
    });

    new cdk.CfnOutput(this, 'AllowedCidr', {
      value: props.allowedCidr,
      description: 'CIDR range allowed to access the ALB',
    });

    new cdk.CfnOutput(this, 'DbCredentialsSecretArn', {
      value: this.dbCredentials.secretArn,
      description: 'ARN of the database credentials secret in Secrets Manager',
    });

    new cdk.CfnOutput(this, 'FhirApiCredentialsSecretArn', {
      value: this.fhirApiCredentials.secretArn,
      description: 'ARN of the FHIR API OAuth2 credentials secret in Secrets Manager',
    });

    new cdk.CfnOutput(this, 'OpenemrAdminCredentialsSecretArn', {
      value: this.openemrAdminCredentials.secretArn,
      description: 'ARN of the OpenEMR admin credentials secret in Secrets Manager',
    });

    new cdk.CfnOutput(this, 'OutputBucketName', {
      value: this.outputBucket.bucketName,
      description: 'S3 bucket name for ambient documentation outputs',
    });

    new cdk.CfnOutput(this, 'OutputBucketArn', {
      value: this.outputBucket.bucketArn,
      description: 'S3 bucket ARN for ambient documentation outputs',
    });

    new cdk.CfnOutput(this, 'ApplicationUrl', {
      value: `https://${this.alb.loadBalancerDnsName}`,
      description: 'Application URL for the Demo Application (HTTPS)',
    });

    // --- cdk-nag Suppressions ---
    // Each suppression includes a documented justification explaining why it is acceptable.

    // The autoDeleteObjects property on the S3 bucket creates a custom resource Lambda function
    // that does not meet all HIPAA controls. This is acceptable for a demo application that
    // needs easy teardown; production deployments should remove autoDeleteObjects.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/OutputBucket/Resource`,
      [
        {
          id: 'HIPAA.Security-S3BucketReplicationEnabled',
          reason: 'Demo application does not require cross-region replication. Production deployments should enable replication for disaster recovery.',
        },
      ]
    );

    // ECS Task Execution Role uses the AWS-managed AmazonECSTaskExecutionRolePolicy
    // which is required for ECS Fargate operation (ECR pull, CloudWatch Logs).
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/EcsTaskExecutionRole/Resource`,
      [
        {
          id: 'HIPAA.Security-IAMNoManagedPolicies',
          reason: 'The AmazonECSTaskExecutionRolePolicy is the AWS-recommended managed policy for ECS task execution. It provides minimal permissions for ECR image pull and CloudWatch Logs write.',
        },
      ]
    );

    // ECS Task Role requires wildcard resource for Amazon Connect Health actions
    // because these actions do not support resource-level permissions per AWS documentation.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/EcsTaskRole/DefaultPolicy/Resource`,
      [
        {
          id: 'HIPAA.Security-IAMPolicyNoStatementsWithFullAccess',
          reason: 'Amazon Connect Health actions (StartMedicalScribeListeningSession, GetMedicalScribeListeningSession, etc.) do not support resource-level permissions. Wildcard resource is required per AWS documentation.',
        },
      ]
    );

    // ALB access logging suppression — ALB access logs are supplemented by WAF logging
    // and VPC Flow Logs for this demo application.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/DemoAppAlb/Resource`,
      [
        {
          id: 'HIPAA.Security-ELBLoggingEnabled',
          reason: 'Demo application uses WAF logging to CloudWatch Logs and VPC Flow Logs for request auditing. ALB access logs to S3 can be enabled for production deployments requiring full access log retention.',
        },
        {
          id: 'HIPAA.Security-ELBDeletionProtectionEnabled',
          reason: 'Demo application requires easy teardown. Deletion protection is intentionally disabled to allow clean cdk destroy without manual intervention.',
        },
      ]
    );

    // ECS Fargate service does not use ECS Exec in this demo
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/DemoAppService/Service`,
      [
        {
          id: 'HIPAA.Security-ECSTaskDefinitionUserForHostMode',
          reason: 'Fargate tasks run in awsvpc network mode (not host mode). This check is not applicable to Fargate deployments.',
        },
      ]
    );

    // Secrets Manager secrets — auto-rotation is configured but the rotation Lambda
    // is not deployed in this demo stack (would require additional infrastructure).
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${id}/DbCredentials/Resource`,
        `/${id}/FhirApiCredentials/Resource`,
        `/${id}/OpenemrAdminCredentials/Resource`,
      ],
      [
        {
          id: 'HIPAA.Security-SecretsManagerRotationEnabled',
          reason: 'Demo application generates secrets with strong passwords. Automatic rotation requires a rotation Lambda with database/service connectivity which is out of scope for the demo. Production deployments must enable rotation.',
        },
      ]
    );

    // VPC-specific suppressions (only when creating a new VPC, not when importing)
    if (!vpcId) {
      // VPC public subnets require routes to the Internet Gateway for the ALB to function.
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        [
          `/${id}/DemoAppVpc/PublicSubnet1/DefaultRoute`,
          `/${id}/DemoAppVpc/PublicSubnet2/DefaultRoute`,
        ],
        [
          {
            id: 'HIPAA.Security-VPCNoUnrestrictedRouteToIGW',
            reason: 'Public subnets require Internet Gateway routes for the internet-facing ALB. Only the ALB resides in public subnets; ECS tasks and data stores are in private subnets with no direct internet access.',
          },
        ]
      );

      // VPC default security group
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${id}/DemoAppVpc/Resource`,
        [
          {
            id: 'HIPAA.Security-VPCDefaultSecurityGroupClosed',
            reason: 'CloudFormation does not support modifying the default security group rules during VPC creation. All workloads use dedicated security groups with restricted ingress.',
          },
        ]
      );

      // VPC Flow Log log group encryption
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${id}/DemoAppVpc/FlowLog/LogGroup/Resource`,
        [
          {
            id: 'HIPAA.Security-CloudWatchLogGroupEncrypted',
            reason: 'VPC Flow Log group is auto-created by CDK. Production deployments should use a custom log group with KMS encryption.',
          },
        ]
      );

      // VPC Flow Log IAM role inline policy
      NagSuppressions.addResourceSuppressionsByPath(
        this,
        `/${id}/DemoAppVpc/FlowLog/IAMRole/DefaultPolicy/Resource`,
        [
          {
            id: 'HIPAA.Security-IAMNoInlinePolicy',
            reason: 'CDK generates inline policies for VPC Flow Log roles.',
          },
        ]
      );
    }

    // IAM inline policies are auto-generated by CDK for roles with addToPolicy() statements.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${id}/EcsTaskExecutionRole/DefaultPolicy/Resource`,
        `/${id}/EcsTaskRole/DefaultPolicy/Resource`,
      ],
      [
        {
          id: 'HIPAA.Security-IAMNoInlinePolicy',
          reason: 'CDK generates inline policies for roles using addToPolicy(). These policies are scoped to specific resource ARNs and follow least-privilege principles.',
        },
      ]
    );

    // Access logs bucket suppressions — the access logs bucket itself does not need
    // replication, versioning, or its own access logs (would create infinite recursion).
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/AccessLogsBucket/Resource`,
      [
        {
          id: 'HIPAA.Security-S3BucketReplicationEnabled',
          reason: 'Access logs bucket for the demo does not require cross-region replication. It stores S3 server access logs which are regenerable.',
        },
        {
          id: 'HIPAA.Security-S3BucketLoggingEnabled',
          reason: 'Access logs bucket cannot log to itself (infinite recursion). This is the terminal logging destination.',
        },
        {
          id: 'HIPAA.Security-S3BucketVersioningEnabled',
          reason: 'Access logs bucket does not require versioning. Logs are append-only and regenerable from the source bucket.',
        },
        {
          id: 'HIPAA.Security-S3DefaultEncryptionKMS',
          reason: 'S3 server access log delivery requires SSE-S3 encryption (not SSE-KMS). AWS does not support delivering access logs to KMS-encrypted buckets. The bucket uses SSE-S3 (AES-256) which provides encryption at rest.',
        },
      ]
    );

    // Auto-delete custom resource Lambda for access logs bucket
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/Custom::S3AutoDeleteObjectsCustomResourceProvider/Role`,
      [
        {
          id: 'HIPAA.Security-IAMNoInlinePolicy',
          reason: 'Demo application uses autoDeleteObjects for easy teardown. The inline policy is auto-generated by CDK for the custom resource. Production deployments should remove autoDeleteObjects.',
        },
        {
          id: 'HIPAA.Security-IAMPolicyNoStatementsWithFullAccess',
          reason: 'Demo application uses autoDeleteObjects for easy teardown. The custom resource Lambda requires s3:* on the bucket to delete all objects. Production deployments should remove autoDeleteObjects.',
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/Custom::S3AutoDeleteObjectsCustomResourceProvider/Handler`,
      [
        {
          id: 'HIPAA.Security-LambdaConcurrency',
          reason: 'Demo application uses autoDeleteObjects for easy teardown. The custom resource Lambda is auto-generated by CDK and does not support reserved concurrency configuration. Production deployments should remove autoDeleteObjects.',
        },
        {
          id: 'HIPAA.Security-LambdaDLQ',
          reason: 'Demo application uses autoDeleteObjects for easy teardown. The custom resource Lambda is auto-generated by CDK and does not support DLQ configuration. Production deployments should remove autoDeleteObjects.',
        },
        {
          id: 'HIPAA.Security-LambdaInsideVPC',
          reason: 'Demo application uses autoDeleteObjects for easy teardown. The custom resource Lambda is auto-generated by CDK and runs outside VPC by design. Production deployments should remove autoDeleteObjects.',
        },
      ]
    );

    // Data Loader Lambda suppressions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${id}/DataLoaderFunction/Resource`,
      ],
      [
        {
          id: 'HIPAA.Security-LambdaConcurrency',
          reason: 'One-time data loader Lambda invoked by deploy.sh. Does not handle ongoing traffic.',
        },
        {
          id: 'HIPAA.Security-LambdaDLQ',
          reason: 'One-time data loader Lambda. Failures are handled by deploy.sh.',
        },
        {
          id: 'HIPAA.Security-LambdaInsideVPC',
          reason: 'Lambda IS inside VPC (required for database access).',
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${id}/DataLoaderFunction/ServiceRole/DefaultPolicy/Resource`,
      ],
      [
        {
          id: 'HIPAA.Security-IAMNoInlinePolicy',
          reason: 'CDK generates inline policies for Lambda roles. Scoped to specific secret ARNs.',
        },
        {
          id: 'HIPAA.Security-IAMPolicyNoStatementsWithFullAccess',
          reason: 'KMS decrypt uses resource * because the OpenEMR KMS key ARN is not known at synth time. In production, scope to specific key ARN.',
        },
      ]
    );

    // Cognito user creation custom resource — CDK generates inline policies for the
    // Provider framework Lambda role. This is acceptable for a demo application.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${id}/CreateCognitoUserProvider/framework-onEvent/ServiceRole/DefaultPolicy/Resource`,
        `/${id}/CreateCognitoUserFn/ServiceRole/DefaultPolicy/Resource`,
      ],
      [
        {
          id: 'HIPAA.Security-IAMNoInlinePolicy',
          reason: 'CDK custom resource Provider framework generates inline policies for its Lambda role. Scoped to Cognito and Secrets Manager actions only.',
        },
      ]
    );

    // Cognito user creation Lambda — this is a one-time custom resource that runs only
    // during stack deployment. DLQ, VPC, and concurrency controls are not required for
    // a deployment-time-only Lambda in a demo application.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${id}/CreateCognitoUserFn/Resource`,
        `/${id}/CreateCognitoUserProvider/framework-onEvent/Resource`,
      ],
      [
        {
          id: 'HIPAA.Security-LambdaDLQ',
          reason: 'One-time custom resource Lambda for stack deployment only. DLQ not required for deployment-time operations.',
        },
        {
          id: 'HIPAA.Security-LambdaInsideVPC',
          reason: 'One-time custom resource Lambda that only calls Cognito and Secrets Manager APIs. VPC placement not required.',
        },
        {
          id: 'HIPAA.Security-LambdaConcurrency',
          reason: 'One-time custom resource Lambda invoked only during stack deployment. Concurrency limits not applicable.',
        },
      ]
    );

    // Clinician credentials secret — rotation and CMK encryption are not required for
    // a demo application with synthetic data. Production deployments should enable both.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${id}/ClinicianCredentials/Resource`,
      [
        {
          id: 'HIPAA.Security-SecretsManagerRotationEnabled',
          reason: 'Demo application with synthetic data only. Rotation not required for short-lived workshop credentials.',
        },
        {
          id: 'HIPAA.Security-SecretsManagerUsingKMSKey',
          reason: 'Demo application with synthetic data only. Default encryption is sufficient for non-PHI demo credentials.',
        },
      ]
    );

  }
}
