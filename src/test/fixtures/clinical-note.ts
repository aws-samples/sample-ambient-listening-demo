import type { ClinicalNote, EvidenceMapping, SOAPSection } from '@/types';

/**
 * Sample SOAP sections for testing clinical note rendering.
 */
export const sampleSOAPSections: SOAPSection[] = [
  {
    heading: 'Subjective',
    content: 'Patient reports persistent fatigue for the past two weeks. Denies chest pain, shortness of breath, or fever.',
  },
  {
    heading: 'Objective',
    content: 'Vitals: BP 120/80, HR 72, Temp 98.6F. BMI 28. Physical exam unremarkable.',
  },
  {
    heading: 'Assessment',
    content: 'Type 2 Diabetes Mellitus, well-controlled. Fatigue likely related to recent medication adjustment.',
  },
  {
    heading: 'Plan',
    content: 'Continue Metformin 500mg twice daily. Order HbA1c and CBC. Follow up in 4 weeks.',
  },
];

/**
 * Sample evidence mappings linking note statements to transcript moments.
 */
export const sampleEvidenceMappings: EvidenceMapping[] = [
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
  {
    noteStatementId: 'stmt-2',
    noteStatement: 'Denies chest pain, shortness of breath, or fever.',
    sourceType: 'transcript',
    transcriptReference: {
      startTime: 20.0,
      endTime: 25.5,
      content: 'No, no chest pain or anything like that.',
    },
  },
  {
    noteStatementId: 'stmt-3',
    noteStatement: 'Type 2 Diabetes Mellitus, well-controlled.',
    sourceType: 'patient_context',
  },
];

/**
 * Complete clinical note fixture with all SOAP sections and evidence map.
 */
export const sampleFullClinicalNote: ClinicalNote = {
  sections: sampleSOAPSections,
  evidenceMap: sampleEvidenceMappings,
};

/**
 * Minimal clinical note with only required fields.
 */
export const sampleMinimalClinicalNote: ClinicalNote = {
  sections: [
    { heading: 'Subjective', content: 'Patient presents for follow-up.' },
    { heading: 'Objective', content: 'Vitals stable.' },
    { heading: 'Assessment', content: 'Stable condition.' },
    { heading: 'Plan', content: 'Continue current management.' },
  ],
  evidenceMap: [],
};

/**
 * Sample after-visit summary text.
 */
export const sampleAfterVisitSummary =
  'Your visit summary:\n\n' +
  'We discussed your diabetes management today. You mentioned feeling tired for the past two weeks.\n\n' +
  'Next steps:\n' +
  '- Continue taking Metformin 500mg twice daily\n' +
  '- Blood tests ordered: HbA1c and CBC\n' +
  '- Follow-up appointment in 4 weeks\n\n' +
  'If your fatigue worsens or you develop new symptoms, please contact our office.';
