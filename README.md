# Amazon Connect Health — Ambient Clinical Documentation Demo

A full-stack web application demonstrating end-to-end ambient clinical documentation using [Amazon Connect Health](https://aws.amazon.com/connect/health/) integrated with [OpenEMR](https://www.open-emr.org/) on AWS ECS.

Workshop participants experience the complete workflow: retrieving patient data from an EHR, streaming a clinical conversation via HTTP/2 to Amazon Connect Health, viewing real-time transcription with speaker diarization, and reviewing structured SOAP clinical notes with evidence mapping — all written back to the patient record.

## Architecture Overview

The system is composed of three deployment units:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **OpenEMR Infrastructure Stack** | Python CDK (Git submodule) | Deploys OpenEMR on ECS Fargate with Aurora Serverless v2, ElastiCache, and EFS |
| **Demo Application** | Next.js 14 / Node.js on ECS Fargate | Backend API routes, HTTP/2 streaming to Connect Health, FHIR API interactions |
| **Frontend UI** | React 18 / Tailwind CSS | Clinician-facing interface for patient selection, audio capture, transcript, and note review |

**Data flow**: Browser → ALB (HTTPS) → Backend → OpenEMR FHIR API (patient context) + Amazon Connect Health (HTTP/2 audio streaming) → S3 (clinical note output) → FHIR write-back

See the [Design Document](.kiro/specs/ambient-clinical-documentation-demo/design.md) for the full architecture diagram (Mermaid) and detailed component descriptions.

## Quick Start

```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/<org>/amazon-connect-health-ambient.git
cd amazon-connect-health-ambient
npm install

# Deploy to AWS (requires Route53 hosted zone)
./deploy.sh --domain your-domain.example.com

# Tear down when done
./destroy.sh --domain your-domain.example.com
```

For step-by-step manual deployment, see the **[Workshop Guide](docs/WORKSHOP.md)**.

## Git Submodules

### OpenEMR on ECS (`submodules/openemr/`)

| Property | Value |
|----------|-------|
| Repository | [aws-samples/host-openemr-on-aws-fargate](https://github.com/aws-samples/host-openemr-on-aws-fargate) |
| Pinned Tag | **v4.1.1** |
| Technology | Python CDK |
| Purpose | Deploys OpenEMR on ECS Fargate with Aurora Serverless v2, ElastiCache, EFS, and ALB |

### Synthea (`submodules/synthea/`)

| Property | Value |
|----------|-------|
| Repository | [synthetichealth/synthea](https://github.com/synthetichealth/synthea) |
| Technology | Java |
| Purpose | Generates realistic synthetic patient data (FHIR R4 bundles) for the demo |

```bash
# If already cloned without submodules
git submodule update --init --recursive
```

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 18, Next.js 14 (App Router), Tailwind CSS, Web Audio API |
| Backend | Node.js 20 LTS, Next.js API Routes, WebSocket (`ws`) |
| AWS Services | Amazon Connect Health, ECS Fargate, ALB, S3, Secrets Manager, Aurora Serverless v2, ElastiCache, EFS, WAF, KMS |
| Infrastructure | AWS CDK (TypeScript for demo app, Python for OpenEMR), cdk-nag (HIPAA Security) |
| Testing | Jest, fast-check (property-based testing), MSW, Testing Library |
| Data | OpenEMR FHIR R4 API, OpenEMR Standard API (write-back), built-in synthetic patient generator |

## Prerequisites

- Node.js 20 LTS
- **Java 11+** (required for Synthea synthetic patient data generation)
- Python 3.9+ (for OpenEMR CDK stack)
- AWS CDK CLI 2.150+ (`npm install -g aws-cdk@2.150.0`)
- AWS CLI 2.15+ configured with appropriate credentials
- Docker (for CDK asset bundling)
- AWS account with **us-east-1** or **us-west-2** region access
- **A Route53 hosted zone** for your domain (used for HTTPS certificate creation)
- **Amazon Connect Health environment** — You must have Amazon Connect Health enabled in your AWS account before deployment. Contact your AWS account team or request access through the AWS console. The service must be available in your target region (us-east-1 or us-west-2).

## Deploy

Deploy the entire demo with a single command:

```bash
./deploy.sh --domain <your-route53-domain>
```

Example:
```bash
./deploy.sh --domain hda.example.people.aws.dev
```

The script will:
1. Validate prerequisites (tools, credentials, Route53 hosted zone)
2. Create an ACM wildcard certificate for your domain (DNS-validated automatically)
3. Deploy the OpenEMR stack (~35 min)
4. Deploy the Demo App stack (~15 min)
5. Configure database access between stacks
6. Load 100 synthetic patients with clinical notes (including Margaret Smith demo patient)
7. Register and enable the OAuth2 API client for EHR write-back

Options:
- `--region REGION` — Deploy to us-west-2 instead of us-east-1
- `--skip-openemr` — Skip OpenEMR if already deployed
- `--skip-data-load` — Skip synthetic data loading

## Destroy

Remove all resources and stop incurring costs:

```bash
./destroy.sh --domain <your-route53-domain>
```

This destroys both CDK stacks, deletes the ACM certificate, and cleans up DNS validation records.

## Security & Compliance

This demo follows HIPAA security best practices:

- **Network isolation**: All compute runs in private subnets; no 0.0.0.0/0 inbound rules
- **Encryption in transit**: TLS 1.2+ on all connections (HTTPS, HTTP/2, internal)
- **Encryption at rest**: KMS encryption on S3, Aurora, EFS, and ElastiCache
- **Secrets management**: All credentials stored in AWS Secrets Manager (never in env vars or source)
- **Least privilege IAM**: No wildcard resource permissions
- **Compliance validation**: cdk-nag with HIPAA Security rule pack — deployment fails on unresolved findings
- **S3 hardening**: Block all public access, SSL-only bucket policy, SSE-KMS

> **Important**: This demo uses **synthetic patient data only** (Synthea-generated). A Business Associate Agreement (BAA) with AWS is required for production use with real PHI.

## Responsible AI

This application uses AI services (Amazon Connect Health Medical Scribe and Amazon Bedrock) to generate clinical documentation. The following principles apply:

- **Human-in-the-loop**: All AI-generated clinical notes require clinician review and approval before being written to the patient record. The UI provides an editable interface and confirmation dialog to enforce this workflow.
- **Assistive, not deterministic**: AI-generated SOAP notes, transcriptions, and summaries are assistive tools. The clinician maintains full clinical responsibility for all documentation and patient care decisions.
- **No autonomous medical decisions**: AI outputs from this system should not be used as the sole basis for medical diagnoses, treatment plans, or clinical decisions.
- **Content filtering**: For production deployments, enable [Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html) for content filtering on all model invocations.
- **Bias and fairness**: Clinical AI systems may reflect biases present in training data. Regularly evaluate outputs for fairness across patient demographics and clinical contexts.
- **Transparency**: Patients and clinicians should be informed when AI-assisted documentation is in use. AI-generated content is clearly labeled in the UI.
- **Data privacy**: Patient context sent to AI services is limited to what is clinically necessary. All data handling follows HIPAA requirements with encryption in transit and at rest.

## Workshop Guide

The comprehensive workshop guide covers everything from infrastructure deployment to running the full demo:

📖 **[docs/WORKSHOP.md](docs/WORKSHOP.md)**

Topics covered:
- Prerequisites and AWS permissions
- Infrastructure deployment (OpenEMR + Demo App stacks)
- Synthetic patient data loading with Synthea
- Application configuration and verification
- Running the ambient documentation demo
- Troubleshooting common issues
- Cost estimates and teardown instructions

## License

This project is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file for details.
