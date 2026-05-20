import type { PatientContext, FHIRAllergyIntolerance, FHIRMedicationRequest, FHIRCondition } from '@/types';

/**
 * Sample FHIR Patient resource for tests.
 */
export const samplePatient = {
  resourceType: 'Patient' as const,
  id: 'test-patient-1',
  name: [{ given: ['John'], family: 'Doe' }],
  birthDate: '1980-01-15',
  gender: 'male',
};

/**
 * Sample patient context matching the PatientContext interface.
 */
export const samplePatientContext: PatientContext = {
  demographics: {
    name: 'John Doe',
    age: 44,
    sex: 'male',
    dateOfBirth: '1980-01-15',
  },
  allergies: [
    {
      id: 'allergy-1',
      clinicalStatus: 'active',
      code: {
        text: 'Penicillin',
        coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '7980', display: 'Penicillin' }],
      },
    },
  ] satisfies FHIRAllergyIntolerance[],
  medications: [
    {
      id: 'med-1',
      status: 'active',
      medicationCodeableConcept: {
        text: 'Metformin 500mg',
        coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975', display: 'Metformin 500mg' }],
      },
      dosageInstruction: [{ text: '500mg twice daily' }],
    },
  ] satisfies FHIRMedicationRequest[],
  conditions: [
    {
      id: 'condition-1',
      clinicalStatus: 'active',
      code: {
        text: 'Type 2 Diabetes Mellitus',
        coding: [{ system: 'http://snomed.info/sct', code: '44054006', display: 'Type 2 Diabetes Mellitus' }],
      },
      onsetDateTime: '2015-06-01',
    },
  ] satisfies FHIRCondition[],
};
