# Ambient Clinical Documentation Demo

> **Disclaimer**: This sample is provided for demonstration and educational purposes only and is not intended for production use without additional security review and testing. The code has not undergone a formal AppSec review. Before deploying in a production environment, conduct a thorough security assessment, enable all recommended guardrails, and ensure compliance with your organization's security requirements.

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
npm install  # All dependencies use exact version pins in package.json

# Deploy to AWS with a Route53 domain (trusted HTTPS)
./deploy.sh --domain your-domain.example.com --connect-health-domain your-ch-domain

# Or deploy without Route53 using a self-signed certificate (browser warning)
./deploy.sh --self-signed --connect-health-domain your-ch-domain

# Tear down when done
./destroy.sh --domain your-domain.example.com   # or: ./destroy.sh --self-signed
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
- **Java 17+** (required for Synthea synthetic patient data generation)
- Python 3.9+ (for OpenEMR CDK stack)
- AWS CDK CLI 2.150+ (`npm install -g aws-cdk@2.150.0`)
- AWS CLI 2.15+ configured with appropriate credentials
- Docker (for CDK asset bundling)
- AWS account with **us-east-1** or **us-west-2** region access
- **A Route53 hosted zone** for your domain (used for HTTPS certificate creation) — *or* deploy with `--self-signed` to skip Route53 entirely (see [Deploy](#deploy)). Self-signed mode requires `openssl` (preinstalled on macOS and most Linux distros).
- **Amazon Connect Health environment** — You must have Amazon Connect Health enabled in your AWS account before deployment. Contact your AWS account team or request access through the AWS console. The service must be available in your target region (us-east-1 or us-west-2).

## Deploy

There are two ways to obtain the HTTPS certificate the load balancers require. Pick one.

### Option 1 — Route53 domain (trusted certificate, recommended)

Deploy with a domain backed by a Route53 hosted zone. The script requests a DNS-validated ACM certificate and creates the `ambient.<domain>` / `openemr.<domain>` DNS records automatically.

```bash
./deploy.sh --domain <your-route53-domain> --connect-health-domain <your-ch-domain>
```

Example:
```bash
./deploy.sh --domain hda.example.people.aws.dev --connect-health-domain ambient-demo
```

### Option 2 — Self-signed certificate (no Route53 required)

Deploy without a Route53 hosted zone or a public domain. The script generates a self-signed certificate with `openssl`, imports it into ACM, and the app is reached over HTTPS at the raw load balancer DNS names printed at the end of the deployment.

```bash
./deploy.sh --self-signed --connect-health-domain <your-ch-domain>
```

> **⚠️ Self-signed mode is for local/demo/testing use only — never for production.** It is not covered by any security review and deliberately weakens TLS trust (see below). Use Option 1 with a real Route53 domain for anything shared or production-bound.

**What self-signed mode does differently:**

- **Browser trust warning**: A self-signed certificate is **not** trusted by browsers. When you open the app URL you will see a security warning ("Your connection is not private" / `NET::ERR_CERT_AUTHORITY_INVALID`) and must click through to proceed. This is expected.
- **Upstream TLS verification is disabled**: Because OpenEMR's load balancer also serves a self-signed certificate, the app is deployed with `ALLOW_SELF_SIGNED_UPSTREAM=true`. This makes the backend skip TLS certificate verification on its calls to the OpenEMR FHIR API. Without it, patient-context fetch and FHIR write-back would fail against the self-signed OpenEMR endpoint. This flag is set **only** by `--self-signed` and defaults to off; enabling it exposes the FHIR connection to man-in-the-middle attacks and must never be used in production.
- **Optional CN**: You may pass `--domain <name>` alongside `--self-signed` to set the certificate's Common Name; it is cosmetic and no Route53 zone is looked up.

In the trusted Route53 flow (Option 1), certificate verification stays fully enabled end to end and `ALLOW_SELF_SIGNED_UPSTREAM` is never set.

### What the script does

1. Validate prerequisites (tools, credentials, and — in Route53 mode — the hosted zone)
2. Provision the HTTPS certificate: a DNS-validated ACM certificate (Route53 mode) or an imported self-signed certificate (self-signed mode)
3. Deploy the OpenEMR stack (~35 min)
4. Deploy the Demo App stack (~15 min)
5. Configure database access between stacks
6. In Route53 mode, create the `ambient.<domain>` / `openemr.<domain>` DNS records (skipped in self-signed mode)
7. Load 100 synthetic patients with clinical notes (including Margaret Smith demo patient)
8. Register and enable the OAuth2 API client for EHR write-back

Options:
- `--self-signed` — Skip Route53 and use a self-signed certificate (see Option 2)
- `--region REGION` — Deploy to us-west-2 instead of us-east-1
- `--skip-openemr` — Skip OpenEMR if already deployed
- `--skip-data-load` — Skip synthetic data loading

## Destroy

Remove all resources and stop incurring costs. Use the flag that matches how you deployed:

```bash
# Route53 deployment
./destroy.sh --domain <your-route53-domain>

# Self-signed deployment
./destroy.sh --self-signed
```

This destroys both CDK stacks and deletes the certificate. In Route53 mode it also cleans up the `ambient.`/`openemr.` A records and ACM DNS validation records. In self-signed mode it removes the imported self-signed certificate once it is no longer in use.

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

> **⚠️ Self-signed deployment mode is NOT for production.** The `--self-signed` option (see [Deploy → Option 2](#option-2--self-signed-certificate-no-route53-required)) is provided only for local demos and testing. It uses an untrusted certificate and sets `ALLOW_SELF_SIGNED_UPSTREAM=true`, which disables TLS certificate verification on the app's calls to the OpenEMR FHIR API — breaking the "encryption in transit with verified certificates" guarantee above and exposing that connection to man-in-the-middle attacks. For any shared, internet-reachable, or production environment, deploy with a real Route53 domain (Option 1), which keeps certificate verification fully enabled end to end.

## Responsible AI

This application uses AI services to generate clinical documentation:

- **Amazon Connect Health Ambient Listening** — a fully managed AWS service that transcribes clinical conversations and generates structured SOAP notes. Safety and content controls are built into the service and managed by AWS. No separate guardrails configuration is required or supported for this service.
- **Amazon Bedrock (Nova Lite)** — used for clinical note summarization. Bedrock Guardrails are configured via environment variables (`BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION`) for content filtering and output validation.

The following principles apply:

- **Human-in-the-loop**: All AI-generated clinical notes require clinician review and approval before being written to the patient record. The UI provides an editable interface and confirmation dialog to enforce this workflow. Clinicians must verify all AI-generated content against the original transcript and patient context.
- **Assistive, not deterministic**: AI-generated SOAP notes, transcriptions, and summaries are assistive tools. The clinician maintains full clinical responsibility for all documentation and patient care decisions.
- **No autonomous medical decisions**: AI outputs from this system should not be used as the sole basis for medical diagnoses, treatment plans, or clinical decisions.
- **Content filtering**: Amazon Bedrock Guardrails are enabled for clinical note summarization (see `BEDROCK_GUARDRAIL_ID` env var). Amazon Connect Health Ambient Listening includes built-in content safety managed by AWS.
- **Output validation**: AI-generated clinical summaries are validated for non-empty content before display. The clinician review step serves as the final validation gate — summaries that are incomplete or inaccurate should be edited or regenerated.
- **Bias and fairness**: Clinical AI systems may reflect biases present in training data. Regularly evaluate outputs for fairness across patient demographics and clinical contexts.
- **Transparency**: Patients and clinicians should be informed when AI-assisted documentation is in use. AI-generated content is clearly labeled in the UI.
- **Data privacy**: Patient context sent to AI services is limited to what is clinically necessary. All data handling follows HIPAA requirements with encryption in transit and at rest.

## License

This project is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file for details.
