import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import type {
  PatientContext,
  AmbientSession,
  TranscriptSegment,
  ClinicalNote,
  FHIRAllergyIntolerance,
  FHIRMedicationRequest,
  FHIRCondition,
  DocumentReferenceCreate,
} from '@/types';

/**
 * Custom render function that wraps components with common providers.
 * Extend this as providers (e.g., SessionContext) are added.
 */
function AllProviders({ children }: { children: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

function customRender(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// Re-export everything from testing-library
export * from '@testing-library/react';

// Override render with custom version
export { customRender as render };

/**
 * Helper to wait for async operations in tests.
 */
export function waitForMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a mock environment with specified env vars set.
 * Returns a cleanup function to restore original values.
 */
export function mockEnvVars(vars: Record<string, string>): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(vars)) {
    originals[key] = process.env[key];
    process.env[key] = value;
  }

  return () => {
    for (const [key] of Object.entries(vars)) {
      if (originals[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originals[key];
      }
    }
  };
}

// ─── Test Data Factories ─────────────────────────────────────────────────────

/**
 * Creates a PatientContext with optional overrides.
 */
export function createPatientContext(overrides?: Partial<PatientContext>): PatientContext {
  return {
    demographics: {
      name: 'Jane Smith',
      age: 55,
      sex: 'female',
      dateOfBirth: '1969-03-22',
    },
    allergies: [
      {
        id: 'allergy-test-1',
        clinicalStatus: 'active',
        code: { text: 'Sulfa drugs', coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '10831', display: 'Sulfonamide' }] },
      },
    ],
    medications: [
      {
        id: 'med-test-1',
        status: 'active',
        medicationCodeableConcept: { text: 'Lisinopril 10mg', coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '314076', display: 'Lisinopril 10mg' }] },
        dosageInstruction: [{ text: '10mg once daily' }],
      },
    ],
    conditions: [
      {
        id: 'condition-test-1',
        clinicalStatus: 'active',
        code: { text: 'Essential Hypertension', coding: [{ system: 'http://snomed.info/sct', code: '59621000', display: 'Essential Hypertension' }] },
        onsetDateTime: '2018-09-15',
      },
    ],
    ...overrides,
  };
}

/**
 * Creates an AmbientSession with optional overrides.
 */
export function createSession(overrides?: Partial<AmbientSession>): AmbientSession {
  return {
    sessionId: `session-${Date.now()}`,
    domainId: 'domain-test-001',
    subscriptionId: 'sub-test-001',
    status: 'active',
    patientId: 'test-patient-1',
    patientContext: 'Patient: Jane Smith, 55yo female. Allergies: Sulfa drugs. Medications: Lisinopril 10mg.',
    outputS3Uri: 's3://test-bucket/health-agent-listening-session/domain-test-001/sub-test-001/session-test/',
    startedAt: new Date(),
    ...overrides,
  };
}

/**
 * Creates a TranscriptSegment with optional overrides.
 */
export function createTranscriptSegment(overrides?: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    id: `seg-${Date.now()}`,
    content: 'Test transcript content.',
    speaker: 'CLINICIAN',
    channelId: 0,
    startTime: 0,
    endTime: 3.0,
    isPartial: false,
    ...overrides,
  };
}

/**
 * Creates a ClinicalNote with optional overrides.
 */
export function createClinicalNote(overrides?: Partial<ClinicalNote>): ClinicalNote {
  return {
    sections: [
      { heading: 'Subjective', content: 'Patient presents for routine follow-up.' },
      { heading: 'Objective', content: 'Vitals within normal limits.' },
      { heading: 'Assessment', content: 'Hypertension, well-controlled.' },
      { heading: 'Plan', content: 'Continue current medications. Follow up in 3 months.' },
    ],
    evidenceMap: [
      {
        noteStatementId: 'stmt-test-1',
        noteStatement: 'Patient presents for routine follow-up.',
        sourceType: 'transcript',
        transcriptReference: { startTime: 0, endTime: 3.0, content: 'I am here for my regular check-up.' },
      },
    ],
    ...overrides,
  };
}

/**
 * Creates a FHIR DocumentReference for write-back testing.
 */
export function createDocumentReference(
  patientId: string,
  noteContent: string,
  date?: string
): DocumentReferenceCreate {
  const sessionDate = date || new Date().toISOString();
  return {
    resourceType: 'DocumentReference',
    status: 'current',
    type: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '11506-3',
          display: 'Progress note',
        },
      ],
    },
    subject: { reference: `Patient/${patientId}` },
    date: sessionDate,
    description: `Ambient Clinical Note - ${sessionDate.split('T')[0]}`,
    content: [
      {
        attachment: {
          contentType: 'text/plain',
          data: Buffer.from(noteContent).toString('base64'),
        },
      },
    ],
  };
}

/**
 * Creates a batch of FHIR allergy resources for testing.
 */
export function createAllergies(count: number): FHIRAllergyIntolerance[] {
  const allergens = ['Penicillin', 'Sulfa', 'Aspirin', 'Latex', 'Iodine', 'Codeine', 'NSAIDs', 'Shellfish', 'Peanuts', 'Eggs'];
  return Array.from({ length: count }, (_, i) => {
    const name = allergens[i % allergens.length]!;
    return {
      id: `allergy-${i + 1}`,
      clinicalStatus: 'active',
      code: {
        text: name,
        coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: `${7980 + i}`, display: name }],
      },
    };
  });
}

/**
 * Creates a batch of FHIR medication resources for testing.
 */
export function createMedications(count: number): FHIRMedicationRequest[] {
  const meds = ['Metformin 500mg', 'Lisinopril 10mg', 'Atorvastatin 20mg', 'Omeprazole 20mg', 'Amlodipine 5mg', 'Levothyroxine 50mcg'];
  return Array.from({ length: count }, (_, i) => {
    const name = meds[i % meds.length]!;
    return {
      id: `med-${i + 1}`,
      status: 'active',
      medicationCodeableConcept: {
        text: name,
        coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: `${860975 + i}`, display: name }],
      },
      dosageInstruction: [{ text: `Take ${name} as directed` }],
    };
  });
}

/**
 * Creates a batch of FHIR condition resources for testing.
 */
export function createConditions(count: number): FHIRCondition[] {
  const conditions = ['Type 2 Diabetes', 'Essential Hypertension', 'Hyperlipidemia', 'GERD', 'Osteoarthritis', 'Asthma'];
  return Array.from({ length: count }, (_, i) => {
    const name = conditions[i % conditions.length]!;
    return {
      id: `condition-${i + 1}`,
      clinicalStatus: 'active',
      code: {
        text: name,
        coding: [{ system: 'http://snomed.info/sct', code: `${44054006 + i}`, display: name }],
      },
      onsetDateTime: `${2015 + (i % 8)}-01-01`,
    };
  });
}
