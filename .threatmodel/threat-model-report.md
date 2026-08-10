# Comprehensive Threat Model Report

**Generated**: 2026-08-06 16:34:04
**Current Phase**: 9 - Output Generation and Documentation
**Overall Completion**: 90.0%

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Business Context](#business-context)
3. [System Architecture](#system-architecture)
4. [Threat Actors](#threat-actors)
5. [Trust Boundaries](#trust-boundaries)
6. [Assets and Flows](#assets-and-flows)
7. [Threats](#threats)
8. [Mitigations](#mitigations)
9. [Assumptions](#assumptions)
10. [Phase Progress](#phase-progress)

## Executive Summary

### Key Statistics

- **Total Threats**: 14
- **Total Mitigations**: 14
- **Total Assumptions**: 4
- **System Components**: 13
- **Assets**: 8
- **Threat Actors**: 10

## Business Context

### Business Features


## System Architecture

### Components

| ID | Name | Type | Service Provider | Description |
|---|---|---|---|---|
| C001 | Next.js Web Application | Compute | AWS | Next.js frontend and API routes running on ECS Fargate. Serves clinician UI, handles WebSocket audio streaming, session management, patient context, and EMR writeback APIs. |
| C002 | Application Load Balancer | Network | AWS | Internet-facing ALB with HTTPS listener, Cognito authentication integration, and WAF. Routes traffic to ECS tasks. |
| C003 | S3 Output Bucket | Storage | AWS | Stores Connect Health session outputs including clinical notes, transcripts, and after-visit summaries. Encrypted with KMS. |
| C004 | Aurora MySQL (OpenEMR Database) | Storage | AWS | Aurora MySQL cluster hosting OpenEMR database. Stores patient demographics, encounters, clinical notes. Encrypted at rest with KMS, TLS in transit. |
| C005 | OpenEMR ECS Service | Compute | AWS | OpenEMR application on Fargate providing FHIR R4 API and web console. Accessed by demo app for patient data and encounter writeback. |
| C006 | AWS Secrets Manager | Security | AWS | Stores DB credentials, FHIR API OAuth credentials, and clinician login credentials. Referenced by ECS task definitions. |
| C007 | AWS KMS | Security | AWS | Customer-managed keys for encrypting S3 output bucket, Aurora database, Secrets Manager secrets, and CloudWatch Logs. |
| C008 | Data Loader Lambda | Compute | AWS | Loads synthetic patient data (Synthea bundles) and Margaret Smith demo patient into OpenEMR database. Runs in VPC. |
| C009 | WebSocket Server (start-server.js) | Compute | AWS | Custom Node.js WebSocket server embedded in ECS task. Proxies audio from browser to Connect Health streaming API. Handles stereo conversion and session management. |
| C010 | Amazon Cognito User Pool | Security | AWS | Manages clinician authentication. ALB integrates with Cognito for OAuth2 authentication flow before forwarding requests. |
| C011 | CloudWatch Logs | Network | AWS | Centralized logging for ECS tasks and Lambda functions. Encrypted with KMS. PHI-sanitized operational logs. |
| C012 | Amazon Connect Health Service | Other | AWS | Managed service that receives real-time audio streams, performs medical transcription, and generates SOAP clinical notes. |
| C013 | Amazon Bedrock (Nova Lite) | Other | AWS | Summarizes prior encounter notes from OpenEMR to provide patient context. Uses cross-region inference profile us.amazon.nova-lite-v1:0. |

### Connections

| ID | Source | Destination | Protocol | Port | Encrypted | Description |
|---|---|---|---|---|---|---|
| CN001 | C001 | C002 | HTTPS | 443 | Yes | Browser to ALB - clinician web requests |
| CN002 | C002 | C001 | HTTPS | 3000 | Yes | ALB to ECS Fargate task |
| CN003 | C009 | C012 | HTTPS | 443 | Yes | WebSocket server streams audio to Connect Health API |
| CN004 | C012 | C006 | HTTPS | 443 | Yes | Connect Health writes clinical notes and transcripts to S3 |
| CN005 | C001 | C006 | HTTPS | 443 | Yes | App retrieves session outputs from S3 |
| CN006 | C001 | C013 | HTTPS | 443 | Yes | App invokes Bedrock for encounter note summarization |
| CN007 | C001 | C008 | HTTPS | 443 | Yes | App calls Secrets Manager to retrieve DB and FHIR credentials |
| CN008 | C001 | C004 | HTTPS | 443 | Yes | App queries OpenEMR FHIR API for patient data |
| CN009 | C002 | C010 | HTTPS | 443 | Yes | ALB authenticates users via Cognito OAuth2 flow |
| CN010 | C001 | C009 | HTTPS | 443 | Yes | Browser WebSocket for audio streaming to ECS |
| CN011 | C001 | C007 | TCP | 3306 | Yes | App writes clinical notes to Aurora (encounter writeback) |
| CN012 | C005 | C007 | TCP | 3306 | Yes | Data Loader Lambda loads patient data into Aurora |

### Data Stores

| ID | Name | Type | Classification | Encrypted at Rest | Description |
|---|---|---|---|---|---|
| D001 | Aurora MySQL Database (OpenEMR) | Relational | Restricted | Yes | Patient demographics, encounters, clinical notes, form data. Primary EHR data store containing PHI. |
| D002 | S3 Clinical Notes Bucket | Object Storage | Restricted | Yes | Stores SOAP notes, transcripts, and after-visit summaries from Connect Health sessions. Contains PHI. Versioning enabled. |
| D003 | Secrets Manager Vault | Other | Confidential | Yes | Database credentials, FHIR OAuth credentials, clinician login credentials. Encrypted with KMS CMK. |
| D004 | CloudWatch Log Groups | Other | Internal | Yes | Operational logs from ECS tasks and Lambda. PHI-sanitized (only error names logged, not content). |

## Threat Actors

### Insider

- **Type**: ThreatActorType.INSIDER
- **Capability Level**: CapabilityLevel.MEDIUM
- **Motivations**: Financial, Revenge
- **Resources**: ResourceLevel.LIMITED
- **Relevant**: Yes
- **Priority**: 3/10
- **Description**: Employee or contractor with legitimate access who may exfiltrate patient data or abuse clinical note access.

### External Attacker

- **Type**: ThreatActorType.EXTERNAL
- **Capability Level**: CapabilityLevel.MEDIUM
- **Motivations**: Financial
- **Resources**: ResourceLevel.MODERATE
- **Relevant**: Yes
- **Priority**: 2/10
- **Description**: External attacker exploiting web application vulnerabilities, API flaws, or misconfigurations to access PHI or disrupt clinical workflows.

### Nation-state Actor

- **Type**: ThreatActorType.NATION_STATE
- **Capability Level**: CapabilityLevel.HIGH
- **Motivations**: Espionage, Political
- **Resources**: ResourceLevel.EXTENSIVE
- **Relevant**: No
- **Priority**: 10/10
- **Description**: A government-sponsored group with advanced capabilities

### Hacktivist

- **Type**: ThreatActorType.HACKTIVIST
- **Capability Level**: CapabilityLevel.MEDIUM
- **Motivations**: Ideology, Political
- **Resources**: ResourceLevel.MODERATE
- **Relevant**: No
- **Priority**: 9/10
- **Description**: An individual or group motivated by ideological or political beliefs

### Organized Crime

- **Type**: ThreatActorType.ORGANIZED_CRIME
- **Capability Level**: CapabilityLevel.HIGH
- **Motivations**: Financial
- **Resources**: ResourceLevel.EXTENSIVE
- **Relevant**: Yes
- **Priority**: 1/10
- **Description**: Criminal organizations targeting healthcare PHI for identity theft, insurance fraud, and ransomware. Healthcare records are high-value targets on dark markets.

### Competitor

- **Type**: ThreatActorType.COMPETITOR
- **Capability Level**: CapabilityLevel.MEDIUM
- **Motivations**: Financial, Espionage
- **Resources**: ResourceLevel.MODERATE
- **Relevant**: No
- **Priority**: 8/10
- **Description**: A business competitor seeking competitive advantage

### Script Kiddie

- **Type**: ThreatActorType.SCRIPT_KIDDIE
- **Capability Level**: CapabilityLevel.LOW
- **Motivations**: Curiosity, Reputation
- **Resources**: ResourceLevel.LIMITED
- **Relevant**: Yes
- **Priority**: 6/10
- **Description**: Automated scanners and script kiddies probing exposed endpoints. Low skill but high volume.

### Disgruntled Employee

- **Type**: ThreatActorType.DISGRUNTLED_EMPLOYEE
- **Capability Level**: CapabilityLevel.MEDIUM
- **Motivations**: Revenge
- **Resources**: ResourceLevel.LIMITED
- **Relevant**: Yes
- **Priority**: 5/10
- **Description**: Former clinician or IT staff seeking to damage the system or exfiltrate data post-termination.

### Privileged User

- **Type**: ThreatActorType.PRIVILEGED_USER
- **Capability Level**: CapabilityLevel.HIGH
- **Motivations**: Financial, Accidental
- **Resources**: ResourceLevel.MODERATE
- **Relevant**: Yes
- **Priority**: 4/10
- **Description**: Admin or DevOps engineer with elevated AWS/database access who could accidentally expose PHI or intentionally abuse privileges.

### Third Party

- **Type**: ThreatActorType.THIRD_PARTY
- **Capability Level**: CapabilityLevel.MEDIUM
- **Motivations**: Financial, Accidental
- **Resources**: ResourceLevel.MODERATE
- **Relevant**: Yes
- **Priority**: 7/10
- **Description**: AWS service integrations (Connect Health, Bedrock) or the EHR vendor whose API credentials could be compromised or misconfigured.

## Trust Boundaries

### Trust Zones

#### Internet

- **Trust Level**: TrustLevel.UNTRUSTED
- **Description**: The public internet, considered untrusted

#### DMZ

- **Trust Level**: TrustLevel.LOW
- **Description**: Demilitarized zone for public-facing services

#### Application

- **Trust Level**: TrustLevel.MEDIUM
- **Description**: Zone containing application servers and services

#### Data

- **Trust Level**: TrustLevel.HIGH
- **Description**: Zone containing databases and data storage

#### Admin

- **Trust Level**: TrustLevel.FULL
- **Description**: Administrative zone with highest privileges

#### Internet/Client Zone

- **Trust Level**: TrustLevel.UNTRUSTED
- **Description**: Public internet including clinician browsers. Untrusted by default.

#### DMZ/Edge Zone

- **Trust Level**: TrustLevel.LOW
- **Description**: ALB, WAF, Cognito authentication layer. First line of defense.

#### Application Zone

- **Trust Level**: TrustLevel.MEDIUM
- **Description**: ECS Fargate tasks running the Next.js app and WebSocket server. Authenticated requests only.

#### Data Zone

- **Trust Level**: TrustLevel.HIGH
- **Description**: Aurora MySQL database, Secrets Manager, KMS keys. Highly restricted access.

#### AWS Managed Services Zone

- **Trust Level**: TrustLevel.HIGH
- **Description**: AWS managed services - Connect Health, Bedrock, S3. Controlled via IAM.

### Trust Boundaries

#### Internet Boundary

- **Type**: BoundaryType.NETWORK
- **Controls**: Web Application Firewall, DDoS Protection, TLS Encryption
- **Description**: Boundary between the internet and internal systems

#### DMZ Boundary

- **Type**: BoundaryType.NETWORK
- **Controls**: Network Firewall, Intrusion Detection System, API Gateway
- **Description**: Boundary between public-facing services and internal applications

#### Data Boundary

- **Type**: BoundaryType.NETWORK
- **Controls**: Database Firewall, Encryption, Access Control Lists
- **Description**: Boundary protecting data storage systems

#### Admin Boundary

- **Type**: BoundaryType.NETWORK
- **Controls**: Privileged Access Management, Multi-Factor Authentication, Audit Logging
- **Description**: Boundary for administrative access

#### Internet Perimeter

- **Type**: BoundaryType.NETWORK
- **Controls**: AWS WAF, Rate Limiting, IP Allowlist, Cognito Authentication, TLS 1.2+
- **Description**: Internet-facing boundary protecting the application from untrusted internet traffic

#### Application Boundary

- **Type**: BoundaryType.NETWORK
- **Controls**: Security Groups, Private Subnets, Cognito Session Validation
- **Description**: Boundary between public-facing ALB and internal application compute

#### Data Boundary

- **Type**: BoundaryType.NETWORK
- **Controls**: Security Groups, TLS Certificate Validation, Secrets Manager Credential Rotation, KMS Encryption
- **Description**: Boundary protecting sensitive data stores from application layer

#### AWS Service Boundary

- **Type**: BoundaryType.NETWORK
- **Controls**: IAM Policies (least privilege), VPC Endpoints, KMS Encryption, Resource Policies
- **Description**: Boundary between application and AWS managed services (Connect Health, Bedrock, S3)

## Assets and Flows

### Assets

| ID | Name | Type | Classification | Sensitivity | Criticality | Owner |
|---|---|---|---|---|---|---|
| A001 | Audio Streams (Patient Encounters) | AssetType.DATA | AssetClassification.RESTRICTED | 5 | 5 | Clinical Operations |
| A002 | Clinical Transcripts | AssetType.DATA | AssetClassification.RESTRICTED | 5 | 5 | Clinical Operations |
| A003 | Clinical Notes (SOAP) | AssetType.DATA | AssetClassification.RESTRICTED | 5 | 5 | Clinical Operations |
| A004 | Patient Demographics (PII/PHI) | AssetType.DATA | AssetClassification.RESTRICTED | 5 | 4 | Clinical Operations |
| A005 | Service Credentials | AssetType.CREDENTIAL | AssetClassification.CONFIDENTIAL | 5 | 5 | DevOps |
| A006 | IAM Role Credentials | AssetType.CREDENTIAL | AssetClassification.CONFIDENTIAL | 4 | 4 | DevOps |
| A007 | Authentication Tokens | AssetType.CREDENTIAL | AssetClassification.CONFIDENTIAL | 4 | 4 | Security |
| A008 | After-Visit Summaries | AssetType.DATA | AssetClassification.RESTRICTED | 4 | 3 | Clinical Operations |

## Threats

### Resolved Threats

#### T1: External attacker

**Statement**: A External attacker with network access to the ALB endpoint can bypass Cognito authentication via token forgery or session hijacking, which leads to unauthorized access to clinical data and patient PHI

- **Prerequisites**: with network access to the ALB endpoint
- **Action**: bypass Cognito authentication via token forgery or session hijacking
- **Impact**: unauthorized access to clinical data and patient PHI
- **Impacted Assets**: A007
- **Tags**: STRIDE-S, Authentication

#### T3: Attacker with network position

**Statement**: A Attacker with network position on path between browser and ALB can intercept audio stream or clinical note data in transit, which leads to exposure of PHI from patient encounters

- **Prerequisites**: on path between browser and ALB
- **Action**: intercept audio stream or clinical note data in transit
- **Impact**: exposure of PHI from patient encounters
- **Impacted Assets**: A001, A003
- **Tags**: STRIDE-T, Network

#### T4: Privileged user or attacker

**Statement**: A Privileged user or attacker with database access can modify clinical notes in Aurora after clinician approval, which leads to integrity of medical record compromised, patient safety risk

- **Prerequisites**: with database access
- **Action**: modify clinical notes in Aurora after clinician approval
- **Impact**: integrity of medical record compromised, patient safety risk
- **Impacted Assets**: A003, A004
- **Tags**: STRIDE-T, Data Integrity

#### T6: External attacker or insider

**Statement**: A External attacker or insider with access to S3 bucket or database can exfiltrate clinical transcripts and SOAP notes containing PHI, which leads to large-scale PHI breach requiring HIPAA notification

- **Prerequisites**: with access to S3 bucket or database
- **Action**: exfiltrate clinical transcripts and SOAP notes containing PHI
- **Impact**: large-scale PHI breach requiring HIPAA notification
- **Impacted Assets**: A002, A003, A004
- **Tags**: STRIDE-I, Data Breach

#### T7: Attacker

**Statement**: A Attacker who gains access to CloudWatch Logs can extract PHI from application log entries, which leads to PHI exposure through operational logs

- **Prerequisites**: who gains access to CloudWatch Logs
- **Action**: extract PHI from application log entries
- **Impact**: PHI exposure through operational logs
- **Impacted Assets**: A003, A004
- **Tags**: STRIDE-I, Logging

#### T8: External attacker

**Statement**: A External attacker with internet access to ALB can launch DDoS or resource exhaustion against the application, which leads to clinical workflow disruption during patient encounters

- **Prerequisites**: with internet access to ALB
- **Action**: launch DDoS or resource exhaustion against the application
- **Impact**: clinical workflow disruption during patient encounters
- **Impacted Assets**: A001
- **Tags**: STRIDE-D, Availability

#### T10: Compromised or misconfigured IAM policy

**Statement**: A Compromised or misconfigured IAM policy with overly broad permissions can escalate privileges to access resources beyond intended scope, which leads to unauthorized access to KMS keys, secrets, or other accounts

- **Prerequisites**: with overly broad permissions
- **Action**: escalate privileges to access resources beyond intended scope
- **Impact**: unauthorized access to KMS keys, secrets, or other accounts
- **Impacted Assets**: A005, A006
- **Tags**: STRIDE-E, IAM

#### T11: Attacker

**Statement**: A Attacker who compromises ECS task role credentials can invoke Connect Health or Bedrock APIs with stolen credentials, which leads to unauthorized use of AI services, potential data exfiltration

- **Prerequisites**: who compromises ECS task role credentials
- **Action**: invoke Connect Health or Bedrock APIs with stolen credentials
- **Impact**: unauthorized use of AI services, potential data exfiltration
- **Impacted Assets**: A006
- **Tags**: STRIDE-E, Credential Theft

#### T13: Attacker or misconfiguration

**Statement**: A Attacker or misconfiguration with access to Secrets Manager secret ARN can retrieve plaintext database or FHIR API credentials, which leads to full database access enabling mass PHI exfiltration

- **Prerequisites**: with access to Secrets Manager secret ARN
- **Action**: retrieve plaintext database or FHIR API credentials
- **Impact**: full database access enabling mass PHI exfiltration
- **Impacted Assets**: A005
- **Tags**: STRIDE-I, Secrets

#### T14: Supply chain attacker

**Statement**: A Supply chain attacker who compromises npm dependency can inject malicious code into application via compromised package, which leads to remote code execution in ECS task with access to all PHI

- **Prerequisites**: who compromises npm dependency
- **Action**: inject malicious code into application via compromised package
- **Impact**: remote code execution in ECS task with access to all PHI
- **Impacted Assets**: A001, A003, A005
- **Tags**: STRIDE-T, Supply Chain

### Identified Threats

#### T2: Malicious insider or compromised clinician account

**Statement**: A Malicious insider or compromised clinician account with valid Cognito credentials can access patient records beyond their authorized scope, which leads to unauthorized PHI disclosure violating HIPAA minimum necessary

- **Prerequisites**: with valid Cognito credentials
- **Action**: access patient records beyond their authorized scope
- **Impact**: unauthorized PHI disclosure violating HIPAA minimum necessary
- **Impacted Assets**: A004, A003
- **Tags**: STRIDE-S, Authorization

#### T5: Malicious actor

**Statement**: A Malicious actor who has compromised the ECS task or credentials can deny responsibility for clinical note modifications, which leads to inability to audit who modified patient records

- **Prerequisites**: who has compromised the ECS task or credentials
- **Action**: deny responsibility for clinical note modifications
- **Impact**: inability to audit who modified patient records
- **Impacted Assets**: A003
- **Tags**: STRIDE-R, Audit

#### T9: Automated scanner or attacker

**Statement**: A Automated scanner or attacker targeting exposed WebSocket endpoint can flood WebSocket connections exhausting ECS task resources, which leads to active audio streaming sessions interrupted mid-encounter

- **Prerequisites**: targeting exposed WebSocket endpoint
- **Action**: flood WebSocket connections exhausting ECS task resources
- **Impact**: active audio streaming sessions interrupted mid-encounter
- **Impacted Assets**: A001
- **Tags**: STRIDE-D, WebSocket

#### T12: AI model (Bedrock or Connect Health)

**Statement**: A AI model (Bedrock or Connect Health) processing patient encounter data can generate inaccurate clinical notes or hallucinated content, which leads to incorrect medical documentation leading to patient harm

- **Prerequisites**: processing patient encounter data
- **Action**: generate inaccurate clinical notes or hallucinated content
- **Impact**: incorrect medical documentation leading to patient harm
- **Impacted Assets**: A003
- **Tags**: STRIDE-T, AI Safety, Responsible AI

## Mitigations

### Resolved Mitigations

#### M1: Cognito User Pool with OAuth2 integration at ALB level. All requests authenticated before reaching application.

**Addresses Threats**: T1, T2

#### M2: AWS WAF WebACL with rate limiting, IP allowlist, and managed rule groups attached to ALB.

**Addresses Threats**: T8, T9

#### M3: TLS 1.2+ encryption on all connections. ALB terminates HTTPS, Aurora uses RDS CA bundle for TLS verification.

**Addresses Threats**: T3

#### M4: KMS encryption at rest for S3 output bucket, Aurora database, Secrets Manager secrets, and CloudWatch Logs.

**Addresses Threats**: T6, T13

#### M5: Least-privilege IAM policies scoped to specific resource ARNs. No wildcard actions except where APIs require it.

**Addresses Threats**: T10, T11

#### M6: Secrets Manager for all credentials with no plain-text environment variables. ECS references via secrets property.

**Addresses Threats**: T13

#### M7: Parameterized SQL queries for all database operations preventing SQL injection.

**Addresses Threats**: T4

#### M8: PHI-sanitized logging - only error names/types logged, never clinical content or patient data.

**Addresses Threats**: T7

#### M9: Private subnets with security groups restricting database access to ECS tasks only.

**Addresses Threats**: T6

#### M10: Human-in-the-loop validation for AI-generated clinical notes before EHR submission.

**Addresses Threats**: T12

#### M12: Pinned dependency versions in package.json and package-lock.json to prevent supply chain attacks.

**Addresses Threats**: T14

#### M14: S3 bucket policies blocking public access and restricting writes to Connect Health service principal only.

**Addresses Threats**: T6

### In Progress Mitigations

#### M11: Amazon Bedrock Guardrails for content filtering on AI model invocations.

**Addresses Threats**: T12

#### M13: CloudTrail and CloudWatch monitoring for security-relevant API calls and anomalous behavior.

**Addresses Threats**: T5

## Assumptions

### A001: Residual Risk

**Description**: Authorization scoping (HIPAA minimum necessary) is not enforced at application level - all authenticated clinicians can access all patients

- **Impact**: Accepted risk for demo/enablement context. Production deployments must implement role-based patient access controls.
- **Rationale**: Demo app has a small, trusted user base. Implementing per-patient RBAC adds significant complexity beyond demo scope.

### A002: Residual Risk

**Description**: No formal audit trail for clinical note modifications beyond CloudWatch logs

- **Impact**: Repudiation threat partially mitigated but not fully addressed. Production requires immutable audit logs.
- **Rationale**: CloudWatch provides basic logging but lacks tamper-proof guarantees needed for clinical record integrity.

### A003: Residual Risk

**Description**: WebSocket connection flooding has limited mitigation beyond WAF rate limiting

- **Impact**: Active streaming sessions could be disrupted. Acceptable for demo; production needs connection-level throttling.
- **Rationale**: WAF rate limiting covers HTTP but WebSocket upgrade connections need additional application-level controls.

### A004: Residual Risk

**Description**: AI-generated clinical notes may contain inaccuracies (hallucination risk) mitigated by human review but not eliminated

- **Impact**: Clinician must always review AI output. Bedrock Guardrails partially configured but not fully validated.
- **Rationale**: Human-in-the-loop is the primary control. Guardrail ID is environment-configured but content rules need tuning per specialty.

## Phase Progress

| Phase | Name | Completion |
|---|---|---|
| 1 | Business Context Analysis | 100% ✅ |
| 2 | Architecture Analysis | 100% ✅ |
| 3 | Threat Actor Analysis | 100% ✅ |
| 4 | Trust Boundary Analysis | 100% ✅ |
| 5 | Asset Flow Analysis | 100% ✅ |
| 6 | Threat Identification | 100% ✅ |
| 7 | Mitigation Planning | 100% ✅ |
| 7.5 | Code Validation Analysis | 100% ✅ |
| 8 | Residual Risk Analysis | 100% ✅ |
| 9 | Output Generation and Documentation | 0% 🔄 |

---

*This threat model report was generated automatically by the Threat Modeling MCP Server.*
