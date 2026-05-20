import type { AmbientSession, TranscriptSegment, ClinicalNote } from '@/types';

/**
 * Sample session fixture data for tests.
 */
export const sampleSession: AmbientSession = {
  sessionId: 'session-123',
  domainId: 'domain-456',
  subscriptionId: 'sub-789',
  status: 'active',
  patientId: 'test-patient-1',
  patientContext: 'Patient: John Doe, 44yo male. Allergies: Penicillin. Medications: Metformin 500mg.',
  outputS3Uri: 's3://test-bucket/health-agent-listening-session/domain-456/sub-789/session-123/',
  startedAt: new Date('2024-01-15T10:00:00Z'),
};

export const sampleTranscriptSegments: TranscriptSegment[] = [
  {
    id: 'seg-1',
    content: 'How are you feeling today?',
    speaker: 'CLINICIAN',
    channelId: 0,
    startTime: 0,
    endTime: 3.5,
    isPartial: false,
  },
  {
    id: 'seg-2',
    content: 'I have been feeling really tired lately.',
    speaker: 'PATIENT',
    channelId: 1,
    startTime: 4.0,
    endTime: 8.2,
    isPartial: false,
  },
  {
    id: 'seg-3',
    content: 'How long has this been going on?',
    speaker: 'CLINICIAN',
    channelId: 0,
    startTime: 9.0,
    endTime: 12.0,
    isPartial: false,
  },
];

export const sampleClinicalNote: ClinicalNote = {
  sections: [
    { heading: 'Subjective', content: 'Patient reports persistent fatigue for the past two weeks.' },
    { heading: 'Objective', content: 'Vitals: BP 120/80, HR 72, Temp 98.6F. BMI 28.' },
    { heading: 'Assessment', content: 'Type 2 Diabetes Mellitus, well-controlled. Fatigue likely related to medication adjustment.' },
    { heading: 'Plan', content: 'Continue Metformin 500mg. Order HbA1c and CBC. Follow up in 4 weeks.' },
  ],
  evidenceMap: [
    {
      noteStatementId: 'stmt-1',
      noteStatement: 'Patient reports persistent fatigue for the past two weeks.',
      sourceType: 'transcript',
      transcriptReference: {
        startTime: 4.0,
        endTime: 8.2,
        content: 'I have been feeling really tired lately.',
      },
    },
  ],
};
