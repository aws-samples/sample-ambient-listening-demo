# Implementation Plan: Ambient Clinical Documentation Demo

## Overview

This plan implements the full-stack ambient clinical documentation demo in incremental steps: project scaffolding, infrastructure CDK stacks (with security hardening and cdk-nag HIPAA compliance), backend API routes and service modules, frontend UI components, data loading utilities, and workshop documentation. Each task builds on previous work and references specific requirements for traceability.

## Tasks

- [x] 1. Project scaffolding and core configuration
  - [x] 1.1 Initialize Next.js 14 project with TypeScript and Tailwind CSS
    - Create Next.js 14 app with App Router, TypeScript strict mode, Tailwind CSS
    - Configure `tsconfig.json`, `next.config.js`, `tailwind.config.ts`
    - Add dependencies: `@aws-sdk/client-s3`, `@aws-sdk/client-secrets-manager`, `ws`, `fast-check`, `jest`, `@testing-library/react`, `msw`
    - Set up project directory structure: `src/app/`, `src/lib/`, `src/components/`, `src/types/`, `scripts/`, `infrastructure/`
    - _Requirements: 10.1_

  - [x] 1.2 Define TypeScript interfaces and data models
    - Create `src/types/index.ts` with all interfaces: `PatientContext`, `AmbientSession`, `SessionError`, `TranscriptSegment`, `ClinicalNote`, `SOAPSection`, `EvidenceMapping`, `DocumentReferenceCreate`, `AppConfig`, `ErrorResponse`
    - _Requirements: 3.1, 4.2, 6.1, 7.2, 14.2_

  - [x] 1.3 Implement configuration validator with environment variable checking
    - Create `src/lib/config.ts` that reads and validates all required environment variables (`AWS_REGION`, `S3_OUTPUT_BUCKET`, `OPENEMR_FHIR_BASE_URL`, `CONNECT_HEALTH_DOMAIN_NAME`)
    - Secrets (`OPENEMR_CLIENT_ID`, `OPENEMR_CLIENT_SECRET`) are read from Secrets Manager at runtime, not from environment variables
    - Exit with non-zero status listing all missing variables by name
    - Validate region is `us-east-1` or `us-west-2`
    - _Requirements: 10.4, 11.2, 11.3, 13.8_

  - [x] 1.4 Write property test for missing environment variable reporting
    - **Property 11: Missing environment variable reporting**
    - **Validates: Requirements 10.4**

  - [x] 1.5 Write property test for region validation
    - **Property 12: Region validation**
    - **Validates: Requirements 11.2, 11.3**

  - [x] 1.6 Set up Jest and testing infrastructure
    - Configure Jest with TypeScript support, path aliases, and coverage thresholds
    - Set up MSW handlers for FHIR API and S3 mocking
    - Create test utilities and fixtures directory
    - _Requirements: Testing strategy from design_

- [x] 2. OpenEMR infrastructure stack (Git submodule)
  - [x] 2.1 Add openemr-on-ecs as Git submodule
    - Add `host-openemr-on-aws-fargate` repository as Git submodule at `infrastructure/openemr/`
    - Pin to a specific release tag and document the tag in README
    - _Requirements: 12.1_

  - [x] 2.2 Create compatibility verification script
    - Create `scripts/verify-compatibility.ts` that runs `cdk synth` on the OpenEMR submodule
    - Verify expected output keys: FHIR API base URL, OpenEMR web console URL, credentials secret ARN
    - Exit non-zero with descriptive error if keys are missing or synth fails
    - _Requirements: 12.3, 12.4_

- [x] 3. Checkpoint - Ensure project scaffolding is complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Demo App CDK stack with security hardening
  - [x] 4.1 Create CDK stack foundation for demo application
    - Create `infrastructure/demo-app/` with TypeScript CDK stack
    - Define VPC with public subnets (ALB only), private subnets (ECS, Aurora, ElastiCache, EFS), and NAT Gateways for outbound internet
    - Add region validation (fail outside us-east-1/us-west-2)
    - Read OpenEMR stack outputs via cross-stack references or SSM parameters
    - _Requirements: 1.1, 1.3, 1.4, 13.7_

  - [x] 4.2 Configure security groups with restricted ingress
    - Create ALB security group: allow inbound HTTPS (port 443) only from a configurable IP CIDR range (CDK context parameter `allowedCidr`)
    - Create ECS task security group: allow inbound only from ALB security group
    - Create internal OpenEMR ALB security group: allow inbound only from Demo App ECS security group
    - Ensure NO security group has 0.0.0.0/0 or ::/0 inbound rules on any port
    - _Requirements: 13.1, 13.2_

  - [x] 4.3 Write property test for security group ingress validation
    - **Property 14: Security group ingress validation**
    - **Validates: Requirements 13.1, 13.2**

  - [x] 4.4 Configure S3 bucket with encryption and access controls
    - Create S3 output bucket with SSE-KMS encryption (dedicated KMS key)
    - Block all public access (BlockPublicAcls, BlockPublicPolicy, IgnorePublicAcls, RestrictPublicBuckets)
    - Add bucket policy enforcing `aws:SecureTransport` condition (SSL-only)
    - Enable versioning for audit trail
    - Restrict access to Demo Application IAM role only
    - _Requirements: 13.5_

  - [x] 4.5 Configure Secrets Manager for all credentials
    - Store database credentials in Secrets Manager with auto-rotation
    - Store FHIR API OAuth2 client ID and secret in Secrets Manager
    - Store OpenEMR admin credentials in Secrets Manager
    - Configure ECS task definition to reference secrets by ARN via `secrets` property (never plain-text env vars)
    - _Requirements: 13.8_

  - [x] 4.6 Configure IAM roles with least privilege
    - Create ECS task execution role with only required permissions
    - ECS task role permissions: `connecthealth:StartMedicalScribeListeningSession`, `connecthealth:GetMedicalScribeListeningSession`, `connecthealth:CreateDomain`, `connecthealth:CreateSubscription`, `connecthealth:GetDomain`, `connecthealth:ListDomains`
    - S3 permissions: `s3:GetObject`, `s3:ListBucket` scoped to output bucket ARN only
    - Secrets Manager permissions: `secretsmanager:GetSecretValue` scoped to specific secret ARNs only
    - No wildcard (`*`) resource permissions
    - _Requirements: 13.8_

  - [x] 4.7 Configure ECS Fargate service and ALB with TLS
    - Define ECS Fargate service for Next.js app in private subnets
    - Configure ALB with HTTPS listener (ACM certificate), TLS 1.2 minimum
    - Configure WAF association on ALB
    - Ensure all outbound traffic from ECS routes through NAT Gateways
    - Output application URL on successful deployment
    - _Requirements: 10.1, 10.2, 10.5, 13.3, 13.4, 13.7_

  - [x] 4.8 Enable cdk-nag with HIPAA Security rule pack
    - Add `cdk-nag` dependency to CDK project
    - Enable `HIPAASecurityChecks` rule pack on the Demo App stack
    - Configure deployment to fail on unresolved HIPAA findings
    - Add documented justification comments for any necessary suppressions
    - Verify the OpenEMR submodule already includes cdk-nag checks
    - _Requirements: 13.9_

- [x] 5. Checkpoint - Ensure CDK stack synthesizes and cdk-nag passes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. FHIR client module
  - [x] 6.1 Implement FHIR client with OAuth2 authentication
    - Create `src/lib/fhir-client.ts` with client credentials OAuth2 flow
    - Read FHIR client credentials from Secrets Manager at runtime (not env vars)
    - Implement methods: `getPatient()`, `getConditions()`, `getMedications()`, `getAllergies()`, `getMetadata()`
    - Enforce TLS 1.2+ for all FHIR API connections
    - Handle 10-second timeout for all FHIR requests
    - Handle partial failures (some resource types succeed, others fail)
    - _Requirements: 3.1, 3.4, 3.5, 10.3, 13.3, 13.8_

  - [x] 6.2 Implement patient context formatter with priority truncation
    - Create `src/lib/patient-context-formatter.ts`
    - Format patient data as plain text with priority order: demographics → allergies → medications → conditions
    - Truncate to 10KB maximum, always including demographics
    - _Requirements: 3.2_

  - [x] 6.3 Write property test for patient context priority truncation
    - **Property 1: Patient context priority truncation**
    - **Validates: Requirements 3.2**

  - [x] 6.4 Write property test for partial FHIR failure handling
    - **Property 2: Partial FHIR failure handling**
    - **Validates: Requirements 3.5**

  - [x] 6.5 Implement DocumentReference builder for clinical note write-back
    - Create `src/lib/document-reference-builder.ts`
    - Build FHIR DocumentReference with: text attachment (base64), subject reference, session date, LOINC type coding, description
    - _Requirements: 14.2_

  - [x] 6.6 Write property test for DocumentReference structure completeness
    - **Property 13: DocumentReference structure completeness**
    - **Validates: Requirements 14.2**

- [x] 7. Session manager module
  - [x] 7.1 Implement Amazon Connect Health session lifecycle manager
    - Create `src/lib/session-manager.ts`
    - Implement domain creation/reuse (match by name)
    - Implement subscription creation
    - Implement session creation with patient context in `encounterContext.unstructuredContext`
    - Configure channel definitions: CLINICIAN (channel 0), PATIENT (channel 1)
    - Configure `PHYSICAL_SOAP` template and output S3 URI
    - Track lifecycle state: `creating_domain` → `creating_subscription` → `creating_session` → `active` → `ending` → `ended`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 11.1_

  - [x] 7.2 Write property test for session lifecycle state machine
    - **Property 6: Session lifecycle state machine**
    - **Validates: Requirements 4.6**

  - [x] 7.3 Write property test for session lifecycle error stage identification
    - **Property 5: Session lifecycle error stage identification**
    - **Validates: Requirements 4.5**

  - [x] 7.4 Implement HTTP/2 audio streaming to Connect Health
    - Create `src/lib/audio-streamer.ts`
    - Use Node.js native `http2` module for streaming to Amazon Connect Health
    - Enforce TLS 1.2+ on HTTP/2 connection
    - Implement `MedicalScribeAudioEvent` publishing
    - Implement `SessionControlEvent` (END_OF_SESSION) sending
    - Handle stream drops and 30-second silence detection
    - _Requirements: 5.1, 5.2, 5.6, 13.4_

  - [x] 7.5 Implement S3 output retriever with retry logic
    - Create `src/lib/output-retriever.ts`
    - Poll S3 at path: `s3://{bucket}/health-agent-listening-session/{domainId}/{subscriptionId}/{sessionId}/post-stream-action/`
    - Retrieve clinical note from `clinical-notes/` subfolder, transcript, and after-visit summary
    - Implement retry: 3 retries at 10-second intervals, 60-second total timeout
    - _Requirements: 7.1, 7.5, 7.6, 8.1, 8.4, 8.5_

- [x] 8. Checkpoint - Ensure backend modules compile and unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Backend API routes
  - [x] 9.1 Implement patient list and context API routes
    - Create `src/app/api/patients/route.ts` — GET handler listing patients from FHIR API
    - Create `src/app/api/patients/[id]/context/route.ts` — GET handler retrieving and formatting patient context
    - Return formatted context with partial failure warnings
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [x] 9.2 Implement session management API routes
    - Create `src/app/api/sessions/route.ts` — POST handler creating ambient session
    - Create `src/app/api/sessions/[id]/end/route.ts` — POST handler ending session
    - Create `src/app/api/sessions/[id]/outputs/route.ts` — GET handler retrieving outputs from S3
    - Create `src/app/api/sessions/[id]/writeback/route.ts` — POST handler writing clinical note back to OpenEMR
    - Validate region before session creation, return error if unsupported
    - _Requirements: 4.1, 4.2, 4.4, 7.1, 14.1, 14.3, 14.4_

  - [x] 9.3 Implement WebSocket audio streaming endpoint
    - Create `src/lib/websocket-server.ts` with `ws` library
    - Accept audio chunks from browser, forward to HTTP/2 stream via session manager
    - Forward transcript events from Connect Health back to browser
    - Handle connection drops and reconnection
    - _Requirements: 5.1, 5.6_

- [x] 10. Frontend components — Patient selection and context
  - [x] 10.1 Implement PatientSelector component
    - Create `src/components/PatientSelector.tsx`
    - Search and select patients from OpenEMR via `/api/patients`
    - Display patient list with name, DOB, and ID
    - _Requirements: 3.1_

  - [x] 10.2 Implement PatientContextPanel component
    - Create `src/components/PatientContextPanel.tsx`
    - Display formatted patient context (demographics, allergies, medications, conditions)
    - Show warnings for partially failed resource types
    - Block session start until context is loaded
    - _Requirements: 3.3, 3.5_

- [x] 11. Frontend components — Session and audio
  - [x] 11.1 Implement session state management with React Context
    - Create `src/lib/session-context.tsx` with useReducer
    - Manage session lifecycle state, transcript segments, clinical note, AVS
    - Expose actions: startSession, endSession, addTranscript, setOutputs
    - _Requirements: 4.6_

  - [x] 11.2 Implement SessionControls component
    - Create `src/components/SessionControls.tsx`
    - Start/end session buttons, audio source selection (microphone/WAV file)
    - Display current lifecycle stage via `SessionLifecycleIndicator`
    - _Requirements: 4.4, 4.6, 5.3, 5.4_

  - [x] 11.3 Implement audio capture pipeline
    - Create `src/lib/audio-capture.ts`
    - Microphone mode: `getUserMedia()` → AudioWorklet → PCM 16-bit 16kHz → WebSocket
    - WAV file mode: FileReader → parse WAV header → stream PCM at real-time rate → WebSocket
    - Handle microphone permission denial with user-facing error
    - _Requirements: 5.2, 5.3, 5.4, 5.7_

  - [x] 11.4 Write property test for WAV file parsing and streaming
    - **Property 7: WAV file parsing and streaming**
    - **Validates: Requirements 5.4**

  - [x] 11.5 Implement AudioIndicator component
    - Create `src/components/AudioIndicator.tsx`
    - Visual indicator showing audio capture/streaming is active
    - _Requirements: 5.5_

- [x] 12. Frontend components — Transcript display
  - [x] 12.1 Implement TranscriptView component
    - Create `src/components/TranscriptView.tsx`
    - Display transcript segments with speaker labels (CLINICIAN, PATIENT, UNKNOWN)
    - Color-code CLINICIAN vs PATIENT segments with distinct visual styles
    - Auto-scroll to keep most recent segment visible
    - Support highlighting specific segments (for evidence map linking)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 12.2 Write property test for transcript speaker attribution and visual distinction
    - **Property 8: Transcript speaker attribution and visual distinction**
    - **Validates: Requirements 6.2, 6.3**

- [x] 13. Checkpoint - Ensure frontend components render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Frontend components — Clinical note and after-visit summary
  - [x] 14.1 Implement ClinicalNotePanel component
    - Create `src/components/ClinicalNotePanel.tsx`
    - Display clinical note in SOAP format with section headings (Subjective, Objective, Assessment, Plan)
    - Render evidence map with clickable links
    - On statement click, scroll TranscriptView to corresponding moment and highlight segment
    - _Requirements: 7.2, 7.3, 7.4_

  - [x] 14.2 Write property test for clinical note and evidence map rendering completeness
    - **Property 9: Clinical note and evidence map rendering completeness**
    - **Validates: Requirements 7.2, 7.3**

  - [x] 14.3 Implement AfterVisitSummaryPanel component
    - Create `src/components/AfterVisitSummaryPanel.tsx`
    - Display after-visit summary in separate tab/panel from clinical note
    - Render content verbatim as received from Ambient Service
    - Show loading indicator during retrieval, error message on failure
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 14.4 Write property test for after-visit summary verbatim rendering
    - **Property 10: After-visit summary verbatim rendering**
    - **Validates: Requirements 8.3**

  - [x] 14.5 Implement write-back confirmation UI
    - Display confirmation message when clinical note is saved to OpenEMR
    - Show error with retry button (up to 3 attempts) on write-back failure
    - _Requirements: 14.3, 14.4_

- [x] 15. Frontend components — Error handling
  - [x] 15.1 Implement ErrorBoundary and error display components
    - Create `src/components/ErrorBoundary.tsx`
    - Display error details with stage identification and corrective action suggestions
    - Handle session lifecycle errors, FHIR connectivity errors, audio errors
    - _Requirements: 3.4, 4.5, 5.6, 5.7, 7.6, 10.4_

- [x] 16. Data loading utilities
  - [x] 16.1 Implement Synthea data loading script
    - Create `scripts/load-synthea-data.ts`
    - Iterate Synthea-generated FHIR R4 Bundles, POST each to OpenEMR FHIR API
    - Log rejections with bundle filename, continue processing remaining records
    - Print summary: total successful loads, total failed loads
    - Check FHIR API reachability before starting, exit with error if unavailable
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7_

  - [x] 16.2 Write property test for data loading error continuity
    - **Property 3: Data loading error continuity**
    - **Validates: Requirements 2.4**

  - [x] 16.3 Write property test for data loading summary accuracy
    - **Property 4: Data loading summary accuracy**
    - **Validates: Requirements 2.6**

- [x] 17. Checkpoint - Ensure all components and utilities work together
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Main application page and wiring
  - [x] 18.1 Implement main application page layout
    - Create `src/app/page.tsx` as the main clinician-facing UI
    - Wire together: PatientSelector → PatientContextPanel → SessionControls → TranscriptView → ClinicalNotePanel / AfterVisitSummaryPanel
    - Wrap with SessionContext provider
    - Implement tabbed layout for Clinical Note vs After-Visit Summary
    - _Requirements: 3.3, 4.6, 6.1, 7.2, 8.2_

  - [x] 18.2 Implement startup connectivity check
    - On application startup, perform FHIR metadata request to verify OpenEMR connectivity
    - Display connection status in UI
    - _Requirements: 10.3_

  - [x] 18.3 Write integration tests for end-to-end flow
    - Test patient selection → context retrieval → session start → audio streaming → transcript display → session end → output retrieval → write-back
    - Use MSW to mock external services
    - _Requirements: All requirements_

- [x] 19. Workshop documentation
  - [x] 19.1 Create comprehensive workshop guide
    - Create `docs/WORKSHOP.md` with sequential numbered steps
    - Cover: prerequisites, infrastructure deployment, data loading, application configuration, demo execution
    - Include verification command/expected output for each major section
    - Document all prerequisite AWS permissions as specific IAM policy actions
    - Document CLI tools with minimum version numbers
    - Include estimated completion time for each section
    - Document estimated hourly costs for deployed infrastructure
    - Include teardown section with commands and verification step
    - Include troubleshooting guidance for at least 5 failure scenarios
    - Document Synthea configuration parameters
    - Document procedure to update the OpenEMR submodule pinned reference
    - Include HIPAA compliance section: BAA requirement for production, synthetic data only for demo, list of all security controls implemented
    - _Requirements: 2.5, 9.1, 9.2, 9.3, 9.4, 9.5, 12.2, 13.10_

  - [x] 19.2 Update repository README
    - Document project overview, architecture diagram reference, quick start
    - Document Git submodule tag version
    - Link to workshop guide
    - _Requirements: 12.1_

- [x] 20. Final checkpoint - Ensure all tests pass and documentation is complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The OpenEMR CDK stack is Python (Git submodule); all other code is TypeScript
- The backend and frontend are deployed as a single Next.js application container
- MSW is used for mocking FHIR API and S3 in unit/property tests
- Security hardening (Requirement 13) is integrated into the CDK stack tasks (section 4) rather than as a separate phase, ensuring security is built-in from the start
- All secrets are stored in AWS Secrets Manager and referenced by ARN — never as plain-text environment variables
- cdk-nag with HIPAA Security rule pack ensures compliance validation at deploy time

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.6", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2"] },
    { "id": 3, "tasks": ["1.4", "1.5"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.4", "4.5"] },
    { "id": 6, "tasks": ["4.3", "4.6", "4.7"] },
    { "id": 7, "tasks": ["4.8"] },
    { "id": 8, "tasks": ["6.1", "6.2"] },
    { "id": 9, "tasks": ["6.3", "6.4", "6.5", "7.1"] },
    { "id": 10, "tasks": ["6.6", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 11, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 12, "tasks": ["10.1", "10.2", "11.1"] },
    { "id": 13, "tasks": ["11.2", "11.3", "11.5"] },
    { "id": 14, "tasks": ["11.4", "12.1"] },
    { "id": 15, "tasks": ["12.2", "14.1", "14.3"] },
    { "id": 16, "tasks": ["14.2", "14.4", "14.5", "15.1"] },
    { "id": 17, "tasks": ["16.1"] },
    { "id": 18, "tasks": ["16.2", "16.3"] },
    { "id": 19, "tasks": ["18.1", "18.2"] },
    { "id": 20, "tasks": ["18.3", "19.1", "19.2"] }
  ]
}
```
