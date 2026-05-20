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

# Install dependencies
npm install

# Run locally (requires environment configuration)
npm run dev
```

For complete deployment instructions including AWS infrastructure setup, see the **[Workshop Guide](docs/WORKSHOP.md)**.

## Git Submodules

### OpenEMR on ECS (`infrastructure/openemr/`)

| Property | Value |
|----------|-------|
| Repository | [aws-samples/host-openemr-on-aws-fargate](https://github.com/aws-samples/host-openemr-on-aws-fargate) |
| Pinned Tag | **v4.1.1** |
| Technology | Python CDK |
| Purpose | Deploys OpenEMR on ECS Fargate with Aurora Serverless v2, ElastiCache, EFS, and ALB |

```bash
# If already cloned without submodules
git submodule update --init --recursive

# Update submodule to a newer release tag
cd infrastructure/openemr
git fetch --tags
git checkout <new-tag>
cd ../..
git add infrastructure/openemr
git commit -m "chore: update openemr submodule to <new-tag>"
```

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 18, Next.js 14 (App Router), Tailwind CSS, Web Audio API |
| Backend | Node.js 20 LTS, Next.js API Routes, WebSocket (`ws`) |
| AWS Services | Amazon Connect Health, ECS Fargate, ALB, S3, Secrets Manager, Aurora Serverless v2, ElastiCache, EFS, WAF, KMS |
| Infrastructure | AWS CDK (TypeScript for demo app, Python for OpenEMR), cdk-nag (HIPAA Security) |
| Testing | Jest, fast-check (property-based testing), MSW, Testing Library |
| Data | OpenEMR FHIR R4 API, Synthea (synthetic patient generation) |

## Prerequisites

- Node.js 20 LTS
- Python 3.x (for OpenEMR CDK stack)
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS CLI configured with appropriate credentials
- AWS account with **us-east-1** or **us-west-2** region access

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
