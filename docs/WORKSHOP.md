# Ambient Clinical Documentation Demo — Workshop Guide

> **Estimated Total Completion Time: 2–3 hours**

This guide walks you through deploying and running the Ambient Clinical Documentation Demo end-to-end. Follow the numbered steps sequentially — each section includes verification commands to confirm success before proceeding.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Infrastructure Deployment — OpenEMR Stack](#2-infrastructure-deployment--openemr-stack)
3. [Infrastructure Deployment — Demo App Stack](#3-infrastructure-deployment--demo-app-stack)
4. [Synthetic Patient Data Loading](#4-synthetic-patient-data-loading)
5. [Application Configuration](#5-application-configuration)
6. [Demo Execution](#6-demo-execution)
7. [Teardown](#7-teardown)
8. [Updating the OpenEMR Submodule](#8-updating-the-openemr-submodule)
9. [Synthea Configuration Parameters](#9-synthea-configuration-parameters)
10. [HIPAA Compliance](#10-hipaa-compliance)
11. [Troubleshooting](#11-troubleshooting)
12. [Cost Estimates](#12-cost-estimates)

---

## 1. Prerequisites

**Estimated Time: 15–20 minutes**

### 1.1 AWS Account Requirements

You need an AWS account with the following:

- Access to **us-east-1** or **us-west-2** region (Amazon Connect Health is only available in these regions)
- An ACM certificate for HTTPS (can be a self-signed certificate for demo purposes)
- Sufficient service quotas for ECS Fargate, Aurora Serverless v2, and NAT Gateways

### 1.2 Required IAM Permissions

The deploying principal (IAM user or role) requires the following IAM policy actions:

> ⚠️ **Production Note**: The following policy uses ARN patterns scoped to resources created by this workshop's CDK stacks. For production deployments, further restrict Resource ARNs to your specific stack names and use tag-based conditions where supported.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CDKBootstrapAndDeploy",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*"
      ],
      "Comment": "For production, restrict to specific actions: CreateStack, UpdateStack, DeleteStack, DescribeStacks, GetTemplate, ListStacks",
      "Resource": [
        "arn:aws:cloudformation:*:*:stack/CDKToolkit/*",
        "arn:aws:cloudformation:*:*:stack/OpenEMRStack/*",
        "arn:aws:cloudformation:*:*:stack/DemoAppStack/*"
      ]
    },
    {
      "Sid": "IAMRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:PassRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:CreateInstanceProfile",
        "iam:DeleteInstanceProfile",
        "iam:AddRoleToInstanceProfile",
        "iam:RemoveRoleFromInstanceProfile"
      ],
      "Resource": [
        "arn:aws:iam::*:role/cdk-*",
        "arn:aws:iam::*:role/OpenEMRStack-*",
        "arn:aws:iam::*:role/DemoAppStack-*",
        "arn:aws:iam::*:instance-profile/OpenEMRStack-*",
        "arn:aws:iam::*:instance-profile/DemoAppStack-*"
      ]
    },
    {
      "Sid": "NetworkingResources",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateVpc",
        "ec2:DeleteVpc",
        "ec2:CreateSubnet",
        "ec2:DeleteSubnet",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:CreateNatGateway",
        "ec2:DeleteNatGateway",
        "ec2:AllocateAddress",
        "ec2:ReleaseAddress",
        "ec2:CreateInternetGateway",
        "ec2:DeleteInternetGateway",
        "ec2:AttachInternetGateway",
        "ec2:DetachInternetGateway",
        "ec2:CreateRouteTable",
        "ec2:DeleteRouteTable",
        "ec2:CreateRoute",
        "ec2:DeleteRoute",
        "ec2:AssociateRouteTable",
        "ec2:DisassociateRouteTable",
        "ec2:Describe*",
        "ec2:CreateFlowLogs",
        "ec2:DeleteFlowLogs",
        "ec2:CreateTags",
        "ec2:DeleteTags"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": ["us-east-1", "us-west-2"]
        }
      }
    },
    {
      "Sid": "ECSResources",
      "Effect": "Allow",
      "Action": [
        "ecs:CreateCluster",
        "ecs:DeleteCluster",
        "ecs:CreateService",
        "ecs:DeleteService",
        "ecs:UpdateService",
        "ecs:RegisterTaskDefinition",
        "ecs:DeregisterTaskDefinition",
        "ecs:Describe*",
        "ecs:List*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LoadBalancerResources",
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:*"
      ],
      "Comment": "For production, restrict to specific actions: CreateLoadBalancer, DeleteLoadBalancer, CreateTargetGroup, RegisterTargets, CreateListener, DeleteListener",
      "Resource": [
        "arn:aws:elasticloadbalancing:*:*:targetgroup/OpenEMR*/*",
        "arn:aws:elasticloadbalancing:*:*:targetgroup/DemoAp*/*",
        "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/OpenEMR*/*",
        "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/DemoAp*/*",
        "arn:aws:elasticloadbalancing:*:*:listener/app/*/*",
        "arn:aws:elasticloadbalancing:*:*:listener-rule/app/*/*/*"
      ]
    },
    {
      "Sid": "S3Resources",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:PutBucketVersioning",
        "s3:PutEncryptionConfiguration",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucket*",
        "s3:List*",
        "s3:PutBucketLogging",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::cdk-*",
        "arn:aws:s3:::cdk-*/*",
        "arn:aws:s3:::demoappstack-*",
        "arn:aws:s3:::demoappstack-*/*",
        "arn:aws:s3:::openemrstack-*",
        "arn:aws:s3:::openemrstack-*/*"
      ]
    },
    {
      "Sid": "KMSResources",
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:ScheduleKeyDeletion",
        "kms:CreateAlias",
        "kms:DeleteAlias",
        "kms:Describe*",
        "kms:Get*",
        "kms:List*",
        "kms:EnableKeyRotation",
        "kms:PutKeyPolicy",
        "kms:CreateGrant"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": ["us-east-1", "us-west-2"]
        }
      }
    },
    {
      "Sid": "SecretsManagerResources",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:UpdateSecret",
        "secretsmanager:TagResource",
        "secretsmanager:Describe*",
        "secretsmanager:List*"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:DemoAppStack*",
        "arn:aws:secretsmanager:*:*:secret:OpenEMRStack*",
        "arn:aws:secretsmanager:*:*:secret:dbsecret*",
        "arn:aws:secretsmanager:*:*:secret:Password*",
        "arn:aws:secretsmanager:*:*:secret:RdsSlotSecret*"
      ]
    },
    {
      "Sid": "RDSResources",
      "Effect": "Allow",
      "Action": [
        "rds:CreateDBCluster",
        "rds:DeleteDBCluster",
        "rds:CreateDBInstance",
        "rds:DeleteDBInstance",
        "rds:CreateDBSubnetGroup",
        "rds:DeleteDBSubnetGroup",
        "rds:Describe*",
        "rds:ModifyDBCluster",
        "rds:AddTagsToResource"
      ],
      "Resource": [
        "arn:aws:rds:*:*:cluster:openemr*",
        "arn:aws:rds:*:*:db:openemr*",
        "arn:aws:rds:*:*:subgrp:openemr*"
      ]
    },
    {
      "Sid": "ElastiCacheResources",
      "Effect": "Allow",
      "Action": [
        "elasticache:CreateCacheCluster",
        "elasticache:DeleteCacheCluster",
        "elasticache:CreateCacheSubnetGroup",
        "elasticache:DeleteCacheSubnetGroup",
        "elasticache:Describe*",
        "elasticache:AddTagsToResource"
      ],
      "Resource": [
        "arn:aws:elasticache:*:*:cluster:openemr*",
        "arn:aws:elasticache:*:*:subnetgroup:openemr*"
      ]
    },
    {
      "Sid": "EFSResources",
      "Effect": "Allow",
      "Action": [
        "elasticfilesystem:CreateFileSystem",
        "elasticfilesystem:DeleteFileSystem",
        "elasticfilesystem:CreateMountTarget",
        "elasticfilesystem:DeleteMountTarget",
        "elasticfilesystem:Describe*",
        "elasticfilesystem:TagResource"
      ],
      "Resource": [
        "arn:aws:elasticfilesystem:*:*:file-system/*"
      ],
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": ["us-east-1", "us-west-2"]
        }
      }
    },
    {
      "Sid": "WAFResources",
      "Effect": "Allow",
      "Action": [
        "wafv2:CreateWebACL",
        "wafv2:DeleteWebACL",
        "wafv2:AssociateWebACL",
        "wafv2:DisassociateWebACL",
        "wafv2:GetWebACL",
        "wafv2:ListWebACLs",
        "wafv2:PutLoggingConfiguration",
        "wafv2:DeleteLoggingConfiguration"
      ],
      "Resource": [
        "arn:aws:wafv2:*:*:regional/webacl/DemoAppStack*/*",
        "arn:aws:wafv2:*:*:regional/webacl/OpenEMRStack*/*"
      ]
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:PutRetentionPolicy",
        "logs:Describe*",
        "logs:TagResource",
        "logs:PutResourcePolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SSMParameters",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:PutParameter",
        "ssm:DeleteParameter"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:parameter/OpenEMRStack/*",
        "arn:aws:ssm:*:*:parameter/DemoAppStack/*",
        "arn:aws:ssm:*:*:parameter/cdk-bootstrap/*"
      ]
    },
    {
      "Sid": "ACMCertificates",
      "Effect": "Allow",
      "Action": [
        "acm:DescribeCertificate",
        "acm:ListCertificates",
        "acm:GetCertificate"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ConnectHealth",
      "Effect": "Allow",
      "Action": [
        "connecthealth:CreateDomain",
        "connecthealth:CreateSubscription",
        "connecthealth:GetDomain",
        "connecthealth:ListDomains",
        "connecthealth:StartMedicalScribeListeningSession",
        "connecthealth:GetMedicalScribeListeningSession"
      ],
      "Resource": "*"
    }
  ]
}
```

### 1.3 CLI Tools

Install the following tools with the specified minimum versions:

| Tool | Minimum Version | Installation |
|------|----------------|--------------|
| AWS CLI | 2.15.0 | [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| Node.js | 20.0.0 (LTS) | [Download](https://nodejs.org/) |
| npm | 10.0.0 | Included with Node.js |
| AWS CDK CLI | 2.150.0 | `npm install -g aws-cdk@2.150.0` |
| Python | 3.9+ | [Download](https://www.python.org/downloads/) |
| pip | 23.0+ | Included with Python |
| Git | 2.39+ | [Download](https://git-scm.com/) |
| Docker | 24.0+ | [Download](https://www.docker.com/) (for local testing) |
| TypeScript | 5.5+ | `npm install -g typescript@5.5.4` |
| ts-node | 10.9+ | `npm install -g ts-node@10.9.2` |

### 1.4 Verification

```bash
# Verify all tools are installed
aws --version          # aws-cli/2.15.x or higher
node --version         # v20.x.x or higher
npm --version          # 10.x.x or higher
cdk --version          # 2.150.x or higher
python3 --version      # Python 3.9.x or higher
git --version          # git version 2.39.x or higher
```

**Expected output:** All commands return version numbers meeting or exceeding the minimums above.

```bash
# Verify AWS credentials are configured
aws sts get-caller-identity
```

**Expected output:** JSON with your Account, UserId, and Arn.

```bash
# Verify CDK is bootstrapped in your target region
aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1
```

**Expected output:** Stack status `CREATE_COMPLETE` or `UPDATE_COMPLETE`. If not found, run:

```bash
cdk bootstrap aws://ACCOUNT_ID/us-east-1
```


---

## 2. Infrastructure Deployment — OpenEMR Stack

**Estimated Time: 35–45 minutes**

The OpenEMR stack deploys an EHR system on ECS Fargate with Aurora Serverless v2, ElastiCache, and EFS. It is referenced as a Git submodule pinned to version **4.1.1** of the `host-openemr-on-aws-fargate` repository.

### 2.1 Clone the Repository

```bash
git clone --recurse-submodules https://github.com/YOUR_ORG/amazon-connect-health-ambient.git
cd amazon-connect-health-ambient
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

### 2.2 Install OpenEMR Stack Dependencies

```bash
cd submodules/openemr
python3 -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2.3 Configure OpenEMR Stack Context

Edit `submodules/openemr/cdk.json` or pass context parameters at deploy time:

| Parameter | Description | Recommended Value |
|-----------|-------------|-------------------|
| `security_group_ip_range_ipv4` | Your IP CIDR for access | Your IP/32 (e.g., `203.0.113.10/32`) |
| `activate_openemr_apis` | Enable FHIR API | `"true"` |
| `enable_ecs_exec` | Enable ECS Exec for debugging | `"false"` (demo) |
| `rds_deletion_protection` | Protect DB from accidental deletion | `false` (demo) |

```bash
# Set your IP for security group access
export MY_IP=$(curl -s https://checkip.amazonaws.com)
```

### 2.4 Deploy the OpenEMR Stack

```bash
cd submodules/openemr

cdk deploy \
  --context security_group_ip_range_ipv4="${MY_IP}/32" \
  --context activate_openemr_apis="true" \
  --require-approval broadening \
  --region us-east-1
```

> **Note:** Deployment takes approximately 30–40 minutes due to Aurora Serverless v2 and ECS service stabilization.

### 2.5 Verification

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name OpenEmrStack \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus'
```

**Expected output:** `"CREATE_COMPLETE"`

```bash
# Retrieve FHIR API URL from stack outputs
aws cloudformation describe-stacks \
  --stack-name OpenEmrStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`FhirApiBaseUrl`].OutputValue' \
  --output text
```

**Expected output:** A URL like `https://openemr.example.internal/fhir`

```bash
# Test FHIR API connectivity (from within VPC or via VPN)
FHIR_URL=$(aws cloudformation describe-stacks \
  --stack-name OpenEmrStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`FhirApiBaseUrl`].OutputValue' \
  --output text)

curl -s "${FHIR_URL}/metadata" | jq '.resourceType'
```

**Expected output:** `"CapabilityStatement"`

### 2.6 Run Compatibility Verification

```bash
cd ../../  # Return to project root
npx ts-node scripts/verify-compatibility.ts
```

**Expected output:** `✓ All expected output keys present: FhirApiBaseUrl, WebConsoleUrl, CredentialsSecretArn`

---

## 3. Infrastructure Deployment — Demo App Stack

**Estimated Time: 15–20 minutes**

The Demo App stack deploys the Next.js application on ECS Fargate behind an ALB with HTTPS, WAF, and all security controls.

### 3.1 Install Demo App Stack Dependencies

```bash
cd infrastructure/demo-app
npm install
```

### 3.2 Prepare an ACM Certificate

You need an ACM certificate for HTTPS on the ALB. If you don't have one:

```bash
# Request a certificate (replace with your domain)
aws acm request-certificate \
  --domain-name "demo.yourdomain.com" \
  --validation-method DNS \
  --region us-east-1

# Note the CertificateArn from the output
```

For demo purposes without a custom domain, you can use a self-signed certificate imported to ACM.

### 3.3 Deploy the Demo App Stack

```bash
cd infrastructure/demo-app

cdk deploy \
  --context allowedCidr="${MY_IP}/32" \
  --context certificateArn="arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID" \
  --context openemrStackName="OpenEmrStack" \
  --require-approval broadening \
  --region us-east-1
```

### 3.4 Verification

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name DemoAppStack \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus'
```

**Expected output:** `"CREATE_COMPLETE"`

```bash
# Get the application URL
aws cloudformation describe-stacks \
  --stack-name DemoAppStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApplicationUrl`].OutputValue' \
  --output text
```

**Expected output:** `https://DemoA-DemoA-XXXXX.us-east-1.elb.amazonaws.com`

```bash
# Verify the application responds
APP_URL=$(aws cloudformation describe-stacks \
  --stack-name DemoAppStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApplicationUrl`].OutputValue' \
  --output text)

curl -sk -o /dev/null -w "%{http_code}" "${APP_URL}"
```

**Expected output:** `200`

```bash
# Verify cdk-nag HIPAA compliance passed (check synth output)
cd infrastructure/demo-app
cdk synth 2>&1 | grep -i "error"
```

**Expected output:** No errors (cdk-nag findings would have blocked deployment).

---

## 4. Synthetic Patient Data Loading

**Estimated Time: 15–30 minutes**

Load 100 Synthea-generated synthetic patient records into OpenEMR for the demo.

### 4.1 Generate Synthea Data

If you don't already have Synthea output:

```bash
# Download Synthea
git clone https://github.com/synthetichealth/synthea.git /tmp/synthea
cd /tmp/synthea

# Generate 100 patients (FHIR R4 Bundle format)
./run_synthea -p 100 --exporter.fhir.export=true --exporter.fhir.bulk_data=false
```

The output will be in `/tmp/synthea/output/fhir/`. See [Section 9: Synthea Configuration Parameters](#9-synthea-configuration-parameters) for customization options.

### 4.2 Set Environment Variables for Data Loading

```bash
cd /path/to/amazon-connect-health-ambient

# Get FHIR API URL from stack outputs
export OPENEMR_FHIR_BASE_URL=$(aws cloudformation describe-stacks \
  --stack-name OpenEmrStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`FhirApiBaseUrl`].OutputValue' \
  --output text)

# Get FHIR client credentials from Secrets Manager
FHIR_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name DemoAppStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`FhirApiCredentialsSecretArn`].OutputValue' \
  --output text)

export OPENEMR_CLIENT_ID=$(aws secretsmanager get-secret-value \
  --secret-id "${FHIR_SECRET_ARN}" \
  --region us-east-1 \
  --query 'SecretString' --output text | jq -r '.clientId')

export OPENEMR_CLIENT_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "${FHIR_SECRET_ARN}" \
  --region us-east-1 \
  --query 'SecretString' --output text | jq -r '.clientSecret')
```

### 4.3 Run the Data Loading Script

```bash
npx ts-node --project tsconfig.scripts.json scripts/load-synthea-data.ts /tmp/synthea/output/fhir/
```

### 4.4 Verification

**Expected output:**

```
Loading Synthea data from: /tmp/synthea/output/fhir/
FHIR API endpoint: https://openemr.example.internal/fhir

✓ Loaded: Abe604_Koss676_patient_bundle.json
✓ Loaded: Ada123_Smith456_patient_bundle.json
...

════════════════════════════════════════════
  Synthea Data Loading Summary
════════════════════════════════════════════
  Total bundles processed: 100
  Successful loads:        98
  Failed loads:            2
════════════════════════════════════════════
```

> **Note:** A small number of failures is normal — some Synthea bundles may contain resources that OpenEMR doesn't support. The script logs each failure and continues processing.

```bash
# Verify patients are accessible via FHIR API
curl -s "${OPENEMR_FHIR_BASE_URL}/Patient?_count=5" \
  -H "Authorization: Bearer $(curl -s -X POST \
    "${OPENEMR_FHIR_BASE_URL%/fhir}/oauth2/default/token" \
    -d "grant_type=client_credentials&client_id=${OPENEMR_CLIENT_ID}&client_secret=${OPENEMR_CLIENT_SECRET}" \
    | jq -r '.access_token')" \
  | jq '.total'
```

**Expected output:** A number ≥ 90 (total loaded patients).


---

## 5. Application Configuration

**Estimated Time: 5–10 minutes**

The Demo Application reads configuration from environment variables (non-sensitive) and AWS Secrets Manager (sensitive credentials). When deployed via CDK, these are automatically configured in the ECS task definition.

### 5.1 Environment Variables (set in CDK stack)

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_REGION` | AWS region | `us-east-1` |
| `S3_OUTPUT_BUCKET` | S3 bucket for ambient outputs | `demoappstack-outputbucket-xxxxx` |
| `OPENEMR_FHIR_BASE_URL` | OpenEMR FHIR API endpoint | `https://openemr.internal/fhir` |
| `CONNECT_HEALTH_DOMAIN_NAME` | Connect Health domain name | `DemoAppStack-ambient-domain` |

### 5.2 Secrets (stored in AWS Secrets Manager)

| Secret | Contents | Referenced By |
|--------|----------|---------------|
| `DemoAppStack/db-credentials` | `{ "username": "...", "password": "..." }` | ECS task definition |
| `DemoAppStack/fhir-api-credentials` | `{ "clientId": "...", "clientSecret": "..." }` | ECS task definition |
| `DemoAppStack/openemr-admin-credentials` | `{ "username": "...", "password": "..." }` | ECS task definition |

### 5.3 Verification

```bash
# Verify environment variables are set in the ECS task definition
aws ecs describe-task-definition \
  --task-definition DemoAppStack-DemoAppTaskDef \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].environment[*].name'
```

**Expected output:** `["AWS_REGION", "S3_OUTPUT_BUCKET", "OPENEMR_FHIR_BASE_URL", "CONNECT_HEALTH_DOMAIN_NAME"]`

```bash
# Verify secrets are referenced (not plain text)
aws ecs describe-task-definition \
  --task-definition DemoAppStack-DemoAppTaskDef \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].secrets[*].name'
```

**Expected output:** `["DB_CREDENTIALS", "FHIR_API_CREDENTIALS", "OPENEMR_ADMIN_CREDENTIALS"]`

---

## 6. Demo Execution

**Estimated Time: 15–20 minutes**

### 6.1 Access the Application

Open the application URL in your browser:

```bash
# Get the application URL
aws cloudformation describe-stacks \
  --stack-name DemoAppStack \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApplicationUrl`].OutputValue' \
  --output text
```

> **Note:** If using a self-signed certificate, you'll need to accept the browser security warning.

### 6.2 Demo Workflow

Follow these steps in the application UI:

1. **Select a Patient** — Use the patient selector to search and choose a loaded Synthea patient
2. **Review Patient Context** — Verify demographics, conditions, medications, and allergies are displayed
3. **Start Session** — Click "Start Session" to initiate the ambient documentation session
   - The lifecycle indicator will show: Domain Setup → Subscription Setup → Session Creation → Active
4. **Stream Audio** — Choose one of:
   - **Microphone**: Grant browser microphone permission and speak a clinical conversation
   - **WAV File**: Upload a pre-recorded WAV file (PCM 16-bit, 16000 Hz) for a repeatable demo
5. **Observe Transcription** — Watch real-time transcript segments appear with CLINICIAN/PATIENT labels
6. **End Session** — Click "End Session" to stop audio streaming
7. **Review Clinical Note** — View the SOAP-formatted clinical note with evidence mapping
8. **Review After-Visit Summary** — Switch to the AVS tab for the patient-friendly summary
9. **Verify Write-Back** — Confirm the clinical note was saved to the patient record in OpenEMR

### 6.3 Using Pre-Recorded Audio

For repeatable demonstrations, use a pre-recorded WAV file:

- **Format**: PCM 16-bit, 16000 Hz sample rate
- **Channels**: Mono (single speaker mapped to CLINICIAN) or Stereo (channel 0 = CLINICIAN, channel 1 = PATIENT)
- **Duration**: 2–10 minutes recommended for meaningful clinical note generation

```bash
# Verify WAV file format
ffprobe -v quiet -print_format json -show_format -show_streams your-audio.wav | \
  jq '{codec: .streams[0].codec_name, sample_rate: .streams[0].sample_rate, bits_per_sample: .streams[0].bits_per_sample, channels: .streams[0].channels}'
```

**Expected output:**
```json
{
  "codec": "pcm_s16le",
  "sample_rate": "16000",
  "bits_per_sample": "16",
  "channels": "1"
}
```

### 6.4 Verification

```bash
# Verify clinical note was written back to OpenEMR
# (Replace PATIENT_ID with the selected patient's ID)
curl -s "${OPENEMR_FHIR_BASE_URL}/DocumentReference?subject=Patient/PATIENT_ID&_sort=-date&_count=1" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  | jq '.entry[0].resource.description'
```

**Expected output:** `"Ambient Clinical Note - 2024-XX-XX"`

---

## 7. Teardown

**Estimated Time: 15–20 minutes**

Remove all deployed resources to stop incurring costs.

### 7.1 Destroy the Demo App Stack

```bash
cd infrastructure/demo-app

cdk destroy --force --region us-east-1
```

### 7.2 Destroy the OpenEMR Stack

```bash
cd submodules/openemr
source .venv/bin/activate

cdk destroy --force --region us-east-1
```

### 7.3 Clean Up Remaining Resources

```bash
# Delete any orphaned CloudWatch Log Groups
aws logs describe-log-groups \
  --log-group-name-prefix "/ecs/DemoAppStack" \
  --region us-east-1 \
  --query 'logGroups[*].logGroupName' --output text | \
  xargs -I {} aws logs delete-log-group --log-group-name {} --region us-east-1

# Delete any orphaned S3 buckets (CDK autoDeleteObjects should handle this)
aws s3 ls --region us-east-1 | grep -i "demoapp\|openemr" | awk '{print $3}' | \
  xargs -I {} sh -c 'aws s3 rb s3://{} --force --region us-east-1 2>/dev/null || true'
```

### 7.4 Verification — Confirm No Billable Resources Remain

```bash
# Verify Demo App stack is deleted
aws cloudformation describe-stacks \
  --stack-name DemoAppStack \
  --region us-east-1 2>&1 | grep -q "does not exist"
echo "DemoAppStack: DELETED ✓"

# Verify OpenEMR stack is deleted
aws cloudformation describe-stacks \
  --stack-name OpenEmrStack \
  --region us-east-1 2>&1 | grep -q "does not exist"
echo "OpenEmrStack: DELETED ✓"

# Check for any remaining ECS clusters
aws ecs list-clusters --region us-east-1 --query 'clusterArns'

# Check for any remaining NAT Gateways (these incur hourly cost)
aws ec2 describe-nat-gateways \
  --region us-east-1 \
  --filter "Name=state,Values=available" \
  --query 'NatGateways[*].NatGatewayId'

# Check for any remaining RDS clusters
aws rds describe-db-clusters \
  --region us-east-1 \
  --query 'DBClusters[?contains(DBClusterIdentifier, `openemr`) || contains(DBClusterIdentifier, `demo`)].DBClusterIdentifier'
```

**Expected output:** All queries return empty arrays `[]` or "does not exist" messages.

---

## 8. Updating the OpenEMR Submodule

The OpenEMR CDK stack is referenced as a Git submodule pinned to a specific release tag. To update to a newer version:

### 8.1 Check Current Version

```bash
cd submodules/openemr
cat VERSION
git log --oneline -1
```

### 8.2 List Available Releases

```bash
git fetch --tags origin
git tag --sort=-v:refname | head -20
```

### 8.3 Update to a New Release

```bash
# From the project root
cd submodules/openemr

# Checkout the new release tag
git fetch --tags origin
git checkout v5.0.0   # Replace with desired version tag

# Return to project root and update the submodule reference
cd ../..
git add submodules/openemr
git commit -m "chore: update OpenEMR submodule to v5.0.0"
```

### 8.4 Verify Compatibility After Update

```bash
# Run the compatibility verification script
npx ts-node scripts/verify-compatibility.ts
```

**Expected output:** `✓ All expected output keys present`

If the script fails, the new version may have changed its output keys. Check the upstream release notes and update `scripts/verify-compatibility.ts` accordingly.

### 8.5 Test Deployment

```bash
cd submodules/openemr
source .venv/bin/activate
pip install -r requirements.txt   # In case dependencies changed
cdk synth                          # Verify synthesis succeeds
```


---

## 9. Synthea Configuration Parameters

[Synthea](https://github.com/synthetichealth/synthea) generates realistic synthetic patient data. The following parameters control the generated population for this demo.

### 9.1 Recommended Configuration

Create or edit `synthea.properties` in the Synthea directory:

```properties
# Population size
generate.default_population = 100

# Output format
exporter.fhir.export = true
exporter.fhir.bulk_data = false
exporter.fhir.use_us_core_ig = true

# FHIR version
exporter.fhir.version = R4

# Geographic settings (affects demographics)
generate.geography.default_state = Massachusetts
generate.geography.default_city = Bedford

# Age distribution (ensure mix of ages for varied conditions)
generate.demographics.default_age_min = 18
generate.demographics.default_age_max = 85

# Clinical data richness
generate.max_attempts_to_keep_patient = 10

# Disable non-FHIR exports
exporter.ccda.export = false
exporter.csv.export = false
exporter.text.export = false
exporter.hospital.fhir.export = false
exporter.practitioner.fhir.export = false
```

### 9.2 Running Synthea with Custom Configuration

```bash
cd /tmp/synthea

# Using default configuration (100 patients)
./run_synthea -p 100

# Using custom properties file
./run_synthea -p 100 -c /path/to/synthea.properties

# Generate patients with specific conditions (for targeted demos)
./run_synthea -p 20 -m diabetes
./run_synthea -p 20 -m asthma
./run_synthea -p 20 -m hypertension
```

### 9.3 Output Location

Generated FHIR R4 Bundles are written to:
- `output/fhir/` — One JSON file per patient (Bundle resource)
- Each file contains: Patient, Conditions, MedicationRequests, AllergyIntolerances, Encounters, Observations, Procedures, Immunizations

### 9.4 Data Characteristics

The generated data includes:
- **Demographics**: Name, DOB, gender, address, phone, race, ethnicity
- **Conditions**: Chronic and acute conditions with onset/resolution dates
- **Medications**: Active prescriptions with dosage instructions
- **Allergies**: Drug and environmental allergies with severity
- **Encounters**: Office visits, emergency visits, hospitalizations
- **Observations**: Vital signs, lab results
- **Procedures**: Surgical and diagnostic procedures

---

## 10. HIPAA Compliance

### 10.1 Business Associate Agreement (BAA) Requirement

> **⚠️ IMPORTANT: This demo uses synthetic patient data ONLY.**

For **production use** with real Protected Health Information (PHI):
- A signed **Business Associate Agreement (BAA)** with AWS is **required**
- Contact your AWS account team to execute a BAA
- The BAA covers eligible HIPAA services used in this architecture
- Without a BAA, you must NOT process, store, or transmit real PHI

### 10.2 Synthetic Data Only for Demo

This workshop uses exclusively **Synthea-generated synthetic patient data**:
- No real patient data is used at any point
- Synthea data is algorithmically generated and does not correspond to real individuals
- The data is suitable for development, testing, and demonstration purposes
- No BAA is required for this demo deployment

### 10.3 Security Controls Implemented

The following security controls are implemented in this architecture, making it suitable as a **reference architecture for BAA-eligible production deployments**:

#### Network Security
| Control | Implementation |
|---------|---------------|
| No open inbound rules | All security groups restrict inbound to specific CIDRs — no 0.0.0.0/0 or ::/0 |
| HTTPS-only ALB | ALB accepts only port 443 with TLS 1.2+ from configured IP range |
| Private subnets | ECS tasks, Aurora, ElastiCache, EFS in private subnets |
| NAT Gateways | Outbound internet only through NAT Gateways |
| Internal ALB for OpenEMR | Not internet-facing, accessible only from Demo App security group |
| VPC Flow Logs | All traffic logged to CloudWatch for audit |
| WAF | AWS WAF with managed rule set on public ALB |

#### Encryption
| Control | Implementation |
|---------|---------------|
| TLS 1.2+ in transit | All service-to-service communication |
| S3 SSE-KMS | Dedicated KMS key with rotation enabled |
| Aurora encryption at rest | KMS encryption enabled |
| EFS encryption at rest | KMS encryption enabled |
| ElastiCache encryption | At rest and in transit |
| Secrets Manager encryption | Dedicated KMS key for all secrets |
| CloudWatch Logs encryption | KMS encryption for log groups |

#### Access Control
| Control | Implementation |
|---------|---------------|
| IAM least privilege | Task roles scoped to specific resource ARNs |
| No wildcard resources | Exception: Connect Health (does not support resource-level permissions) |
| Secrets Manager | All credentials stored as secrets, referenced by ARN |
| No hardcoded secrets | Never in source code or plain-text environment variables |
| S3 public access blocked | BlockPublicAcls, BlockPublicPolicy, IgnorePublicAcls, RestrictPublicBuckets |
| S3 SSL-only | Bucket policy enforces `aws:SecureTransport` |

#### Compliance Validation
| Control | Implementation |
|---------|---------------|
| cdk-nag HIPAA Security | Enabled on both CDK stacks |
| Deployment gate | Deployment fails on unresolved HIPAA findings |
| Documented suppressions | Each suppression has justification in code comments |
| S3 versioning | Enabled for audit trail |
| Access logging | S3 server access logs enabled |
| ALB deletion protection | Enabled to prevent accidental removal |

#### Audit and Monitoring
| Control | Implementation |
|---------|---------------|
| VPC Flow Logs | Network traffic audit |
| WAF logging | Request-level logging to CloudWatch |
| CloudWatch Container Insights | ECS performance and health monitoring |
| S3 access logs | Object-level access audit |
| CloudTrail | Account-level API audit (when enabled) |

### 10.4 Production Deployment Checklist

Before using this architecture with real PHI:

- [ ] Execute a BAA with AWS
- [ ] Enable AWS CloudTrail with log file validation
- [ ] Enable Secrets Manager automatic rotation with rotation Lambda
- [ ] Enable ALB access logging to S3
- [ ] Configure VPC Flow Log group with KMS encryption
- [ ] Remove `autoDeleteObjects` from S3 buckets
- [ ] Enable S3 cross-region replication for disaster recovery
- [ ] Enable RDS deletion protection
- [ ] Enable stack termination protection
- [ ] Implement backup and recovery procedures
- [ ] Conduct security assessment and penetration testing
- [ ] Document data flow and conduct privacy impact assessment


---

## 11. Troubleshooting

### Scenario 1: CDK Deployment Fails with Region Error

**Symptom:**
```
Error: This stack can only be deployed in us-east-1 or us-west-2. Current region does not match supported regions.
```

**Cause:** Amazon Connect Health ambient documentation is only available in us-east-1 and us-west-2.

**Resolution:**
```bash
# Redeploy specifying a supported region
cdk deploy --region us-east-1
# Or set the default region
export AWS_DEFAULT_REGION=us-east-1
```

---

### Scenario 2: FHIR API Unreachable During Data Loading

**Symptom:**
```
Fatal error: FHIR API is unreachable at https://openemr.internal/fhir. Ensure the OpenEMR stack is deployed and the FHIR API endpoint is available.
```

**Cause:** The OpenEMR ECS service may not be fully stabilized, or the FHIR API is not enabled.

**Resolution:**
1. Verify the OpenEMR stack deployment completed:
   ```bash
   aws cloudformation describe-stacks --stack-name OpenEmrStack --query 'Stacks[0].StackStatus'
   ```
2. Check ECS service status:
   ```bash
   aws ecs describe-services \
     --cluster OpenEmrCluster \
     --services OpenEmrService \
     --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'
   ```
3. Ensure `activate_openemr_apis` was set to `"true"` in the CDK context
4. Wait 5 minutes for the service to stabilize after deployment, then retry

---

### Scenario 3: Session Creation Fails with Permission Error

**Symptom:**
```
Error: Session creation failed at stage 'domain'. AccessDeniedException: User is not authorized to perform connecthealth:CreateDomain
```

**Cause:** The ECS task role is missing Amazon Connect Health permissions, or the service is not available in the configured region.

**Resolution:**
1. Verify the ECS task role has Connect Health permissions:
   ```bash
   aws iam list-role-policies --role-name DemoAppStack-EcsTaskRole-XXXXX
   aws iam get-role-policy --role-name DemoAppStack-EcsTaskRole-XXXXX --policy-name ConnectHealthAmbientAccess
   ```
2. Confirm you're in a supported region (us-east-1 or us-west-2)
3. Verify your account has Amazon Connect Health enabled (contact AWS support if needed)
4. Check if the Connect Health service endpoint is reachable from the VPC

---

### Scenario 4: Audio Streaming Drops or No Transcript Appears

**Symptom:** Audio indicator shows streaming is active, but no transcript segments appear, or the stream drops after a few seconds.

**Cause:** HTTP/2 connection issues, incorrect audio format, or 30-second silence timeout.

**Resolution:**
1. **Check audio format**: Ensure WAV file is PCM 16-bit, 16000 Hz:
   ```bash
   ffprobe -v quiet -show_streams your-audio.wav | grep -E "codec_name|sample_rate|bits_per_sample"
   ```
2. **Check for silence**: The service disconnects after 30 seconds of silence. Ensure audio contains speech.
3. **Check network**: Verify the ECS task can reach Connect Health endpoints:
   ```bash
   # From ECS Exec (if enabled)
   aws ecs execute-command --cluster DemoAppCluster --task TASK_ID \
     --container DemoAppContainer --interactive --command "/bin/sh"
   # Then: curl -v https://connecthealth.us-east-1.amazonaws.com
   ```
4. **Check logs**:
   ```bash
   aws logs tail /ecs/DemoAppStack/demo-app --since 5m --region us-east-1
   ```
5. **Restart session**: End the current session and start a new one.

---

### Scenario 5: Clinical Note Not Available After Session End

**Symptom:** Loading indicator persists for 60+ seconds after session end, then shows "Note generation failed."

**Cause:** The Ambient Service may still be processing, or S3 output path is incorrect.

**Resolution:**
1. **Wait and retry**: Note generation can take 30–90 seconds. Use the manual retry button.
2. **Check S3 output path**:
   ```bash
   BUCKET=$(aws cloudformation describe-stacks --stack-name DemoAppStack \
     --query 'Stacks[0].Outputs[?OutputKey==`OutputBucketName`].OutputValue' --output text)
   
   aws s3 ls "s3://${BUCKET}/health-agent-listening-session/" --recursive
   ```
3. **Check session status**:
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/DemoAppStack/demo-app \
     --filter-pattern "session" \
     --start-time $(date -d '10 minutes ago' +%s000) \
     --region us-east-1
   ```
4. **Verify S3 permissions**: Ensure the task role can read from the output bucket.

---

### Scenario 6: cdk-nag HIPAA Findings Block Deployment

**Symptom:**
```
Error: cdk-nag found HIPAA.Security violations. Deployment blocked.
```

**Cause:** A code change introduced a resource that doesn't meet HIPAA Security requirements.

**Resolution:**
1. Review the findings in the CDK synth output:
   ```bash
   cd infrastructure/demo-app
   cdk synth 2>&1 | grep "HIPAA.Security"
   ```
2. Check the nag report CSV:
   ```bash
   cat cdk.out/HIPAA.Security--DemoAppStack-NagReport.csv
   ```
3. Either fix the resource configuration or add a suppression with documented justification:
   ```typescript
   NagSuppressions.addResourceSuppressionsByPath(this, '/path/to/resource', [{
     id: 'HIPAA.Security-RuleId',
     reason: 'Documented justification for why this is acceptable'
   }]);
   ```

---

### Scenario 7: Write-Back to OpenEMR Fails

**Symptom:** "Failed to save clinical note to patient chart" error with retry option.

**Cause:** FHIR API authentication expired, or DocumentReference resource format is rejected.

**Resolution:**
1. **Retry**: Click the retry button (up to 3 attempts)
2. **Check FHIR API connectivity**:
   ```bash
   curl -s "${OPENEMR_FHIR_BASE_URL}/metadata" | jq '.resourceType'
   ```
3. **Check OAuth2 token**: The token may have expired during a long session. Restarting the session will refresh it.
4. **Check application logs** for the specific FHIR error:
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/DemoAppStack/demo-app \
     --filter-pattern "DocumentReference" \
     --start-time $(date -d '5 minutes ago' +%s000)
   ```

---

## 12. Cost Estimates

### 12.1 Estimated Hourly Costs (us-east-1)

| Resource | Service | Estimated Hourly Cost |
|----------|---------|----------------------|
| ECS Fargate (OpenEMR) | 2 tasks × 2 vCPU, 4 GB | $0.18/hr |
| ECS Fargate (Demo App) | 1 task × 1 vCPU, 2 GB | $0.05/hr |
| Aurora Serverless v2 | 0.5–2 ACU (idle–active) | $0.06–$0.24/hr |
| ElastiCache | cache.t3.micro | $0.017/hr |
| NAT Gateways | 2 gateways | $0.09/hr |
| ALB (Demo App) | 1 ALB | $0.023/hr |
| ALB (OpenEMR) | 1 internal ALB | $0.023/hr |
| EFS | Minimal storage | $0.01/hr |
| S3 | Minimal storage | < $0.01/hr |
| KMS | 3 keys | $0.003/hr |
| WAF | 1 WebACL | $0.007/hr |
| CloudWatch Logs | Log storage | $0.01/hr |
| **Total (idle)** | | **~$0.47/hr** |
| **Total (active demo)** | | **~$0.65/hr** |

### 12.2 Estimated Workshop Cost

| Duration | Estimated Cost |
|----------|---------------|
| 3-hour workshop | $1.50–$2.00 |
| Full day (8 hours) | $4.00–$5.50 |
| Left running 24 hours | $11.00–$16.00 |

### 12.3 Additional Costs

- **Amazon Connect Health**: Charged per session minute (see [pricing page](https://aws.amazon.com/connect/pricing/))
- **Data transfer**: Minimal for demo usage (< $0.10)
- **ACM certificate**: Free for public certificates

> **⚠️ Remember to tear down resources after the workshop** (see [Section 7: Teardown](#7-teardown)) to avoid ongoing charges. NAT Gateways and Aurora Serverless v2 incur costs even when idle.

---

## Appendix A: Project Structure Reference

```
amazon-connect-health-ambient/
├── docs/
│   └── WORKSHOP.md              # This guide
├── infrastructure/
│   ├── openemr/                 # Git submodule (Python CDK stack)
│   │   ├── app.py              # CDK app entry point
│   │   ├── cdk.json            # CDK context configuration
│   │   └── VERSION             # Pinned version (4.1.1)
│   └── demo-app/               # Demo App CDK stack (TypeScript)
│       ├── bin/                 # CDK app entry point
│       ├── lib/
│       │   └── demo-app-stack.ts  # Main stack definition
│       ├── cdk.json            # CDK configuration
│       └── package.json        # Node.js dependencies
├── src/
│   ├── app/                    # Next.js App Router pages and API routes
│   ├── components/             # React UI components
│   ├── lib/                    # Backend service modules
│   └── types/                  # TypeScript interfaces
├── scripts/
│   ├── load-synthea-data.ts    # Synthea data loading utility
│   └── verify-compatibility.ts # Submodule compatibility check
├── .gitmodules                 # Git submodule configuration
├── package.json                # Root project dependencies
└── README.md                   # Project overview
```

---

## Appendix B: Quick Reference Commands

```bash
# Deploy everything (from project root)
cd submodules/openemr && cdk deploy && cd ../demo-app && cdk deploy

# Check application health
curl -sk $(aws cloudformation describe-stacks --stack-name DemoAppStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApplicationUrl`].OutputValue' --output text)

# View application logs
aws logs tail /ecs/DemoAppStack/demo-app --follow --region us-east-1

# Tear down everything
cd infrastructure/demo-app && cdk destroy --force
cd ../openemr && source .venv/bin/activate && cdk destroy --force
```
