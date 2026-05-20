/**
 * TypeScript interfaces and data models for the Ambient Clinical Documentation Demo.
 *
 * These types define the core data structures used throughout the application
 * for patient context, session management, transcription, clinical notes,
 * FHIR write-back, configuration, and error handling.
 */

// ─── Patient Context ─────────────────────────────────────────────────────────

/**
 * Patient context formatted for encounterContext.unstructuredContext.
 * Priority order for truncation: demographics → allergies → medications → conditions.
 * Maximum formatted size: 10KB.
 *
 * @see Requirements 3.1, 3.2
 */
export interface PatientContext {
  demographics: {
    name: string;
    age: number;
    sex: string;
    dateOfBirth: string;
  };
  allergies: FHIRAllergyIntolerance[];
  medications: FHIRMedicationRequest[];
  conditions: FHIRCondition[];
}

/** Simplified FHIR AllergyIntolerance resource fields used in patient context. */
export interface FHIRAllergyIntolerance {
  id: string;
  clinicalStatus: string;
  code: {
    text: string;
    coding?: { system: string; code: string; display: string }[];
  };
  criticality?: string;
  onsetDateTime?: string;
}

/** Simplified FHIR MedicationRequest resource fields used in patient context. */
export interface FHIRMedicationRequest {
  id: string;
  status: string;
  medicationCodeableConcept: {
    text: string;
    coding?: { system: string; code: string; display: string }[];
  };
  dosageInstruction?: { text: string }[];
}

/** Simplified FHIR Condition resource fields used in patient context. */
export interface FHIRCondition {
  id: string;
  clinicalStatus: string;
  code: {
    text: string;
    coding?: { system: string; code: string; display: string }[];
  };
  onsetDateTime?: string;
}

// ─── Session State ───────────────────────────────────────────────────────────

/**
 * Represents the full state of an ambient documentation session.
 * Tracks lifecycle from domain creation through session end.
 *
 * @see Requirements 4.2, 4.6
 */
export interface AmbientSession {
  sessionId: string;
  domainId: string;
  subscriptionId: string;
  status:
    | 'creating_domain'
    | 'creating_subscription'
    | 'creating_session'
    | 'active'
    | 'ending'
    | 'ended'
    | 'error';
  patientId: string;
  patientContext: string;
  outputS3Uri: string;
  startedAt: Date;
  endedAt?: Date;
  error?: SessionError;
}

/**
 * Error details for session lifecycle failures.
 * Identifies the stage where the failure occurred and suggests corrective action.
 *
 * @see Requirements 4.5
 */
export interface SessionError {
  stage: 'domain' | 'subscription' | 'session' | 'streaming' | 'output_retrieval';
  message: string;
  suggestedAction: string;
}

// ─── Transcript ──────────────────────────────────────────────────────────────

/**
 * A single transcript segment from the ambient service.
 * Includes speaker attribution and timing information.
 *
 * @see Requirements 6.1, 6.2
 */
export interface TranscriptSegment {
  id: string;
  content: string;
  speaker: 'CLINICIAN' | 'PATIENT' | 'UNKNOWN';
  channelId: number;
  startTime: number;
  endTime: number;
  isPartial: boolean;
}

// ─── Clinical Note Output ────────────────────────────────────────────────────

/**
 * The structured clinical note output from the ambient service.
 * Contains SOAP sections and evidence mappings linking statements to transcript.
 *
 * @see Requirements 7.2, 7.3
 */
export interface ClinicalNote {
  sections: SOAPSection[];
  evidenceMap: EvidenceMapping[];
}

/**
 * A single SOAP section of the clinical note.
 *
 * @see Requirements 7.2
 */
export interface SOAPSection {
  heading: 'Subjective' | 'Objective' | 'Assessment' | 'Plan';
  content: string;
}

/**
 * Maps a clinical note statement to its source evidence in the transcript
 * or patient context.
 *
 * @see Requirements 7.3, 7.4
 */
export interface EvidenceMapping {
  noteStatementId: string;
  noteStatement: string;
  sourceType: 'transcript' | 'patient_context';
  transcriptReference?: {
    startTime: number;
    endTime: number;
    content: string;
  };
}

// ─── FHIR DocumentReference (Write-back) ────────────────────────────────────

/**
 * FHIR DocumentReference resource for writing the clinical note back to OpenEMR.
 * Uses LOINC coding for progress note document type.
 *
 * @see Requirements 14.2
 */
export interface DocumentReferenceCreate {
  resourceType: 'DocumentReference';
  status: 'current';
  type: {
    coding: [
      {
        system: 'http://loinc.org';
        code: '11506-3';
        display: 'Progress note';
      },
    ];
  };
  subject: { reference: string }; // Patient/{id}
  date: string; // ISO 8601
  description: string; // "Ambient Clinical Note - {date}"
  content: [
    {
      attachment: {
        contentType: 'text/plain';
        data: string; // Base64 encoded clinical note
      };
    },
  ];
}

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Application configuration combining AWS, OpenEMR, Connect Health, and audio settings.
 *
 * @see Requirements 10.4, 11.2
 */
export interface AppConfig {
  aws: {
    region: 'us-east-1' | 'us-west-2';
    s3OutputBucket: string;
  };
  openemr: {
    fhirBaseUrl: string;
    clientId: string;
    clientSecret: string;
  };
  connectHealth: {
    domainName: string;
  };
  audio: {
    sampleRate: number; // minimum 16000
    bitDepth: 16;
    encoding: 'pcm';
  };
}

// ─── Error Response ──────────────────────────────────────────────────────────

/**
 * Standardized error response format used across all API endpoints.
 * Includes machine-readable code, human-readable message, and retry information.
 *
 * @see Requirements 4.5, 7.6, 10.4
 */
export interface ErrorResponse {
  code: string;
  message: string;
  stage?: string;
  suggestedAction?: string;
  retryable: boolean;
  retryCount?: number;
  maxRetries?: number;
}
