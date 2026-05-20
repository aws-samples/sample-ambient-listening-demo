import { http, HttpResponse } from 'msw';

const FHIR_BASE_URL = process.env.OPENEMR_FHIR_BASE_URL || 'http://localhost:9300/apis/default/fhir';

/**
 * MSW request handlers for FHIR API mocking in tests.
 * Covers: Patient, Condition, MedicationRequest, AllergyIntolerance, metadata, DocumentReference.
 */
export const fhirHandlers = [
  // FHIR Metadata (CapabilityStatement)
  http.get(`${FHIR_BASE_URL}/metadata`, () => {
    return HttpResponse.json({
      resourceType: 'CapabilityStatement',
      status: 'active',
      fhirVersion: '4.0.1',
      format: ['json', 'xml'],
      rest: [
        {
          mode: 'server',
          resource: [
            { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }] },
            { type: 'Condition', interaction: [{ code: 'read' }, { code: 'search-type' }] },
            { type: 'MedicationRequest', interaction: [{ code: 'read' }, { code: 'search-type' }] },
            { type: 'AllergyIntolerance', interaction: [{ code: 'read' }, { code: 'search-type' }] },
            { type: 'DocumentReference', interaction: [{ code: 'create' }, { code: 'read' }] },
          ],
        },
      ],
    });
  }),

  // FHIR Patient list
  http.get(`${FHIR_BASE_URL}/Patient`, () => {
    return HttpResponse.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'test-patient-1',
            name: [{ given: ['John'], family: 'Doe' }],
            birthDate: '1980-01-15',
            gender: 'male',
          },
        },
      ],
    });
  }),

  // FHIR Patient by ID
  http.get(`${FHIR_BASE_URL}/Patient/:id`, ({ params }) => {
    return HttpResponse.json({
      resourceType: 'Patient',
      id: params.id,
      name: [{ given: ['John'], family: 'Doe' }],
      birthDate: '1980-01-15',
      gender: 'male',
    });
  }),

  // FHIR Conditions for a patient
  http.get(`${FHIR_BASE_URL}/Condition`, ({ request }) => {
    const url = new URL(request.url);
    const patient = url.searchParams.get('patient');
    return HttpResponse.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        {
          resource: {
            resourceType: 'Condition',
            id: 'condition-1',
            subject: { reference: `Patient/${patient}` },
            code: {
              coding: [{ system: 'http://snomed.info/sct', code: '44054006', display: 'Type 2 Diabetes Mellitus' }],
              text: 'Type 2 Diabetes Mellitus',
            },
            clinicalStatus: {
              coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
            },
            onsetDateTime: '2015-06-01',
          },
        },
      ],
    });
  }),

  // FHIR MedicationRequests for a patient
  http.get(`${FHIR_BASE_URL}/MedicationRequest`, ({ request }) => {
    const url = new URL(request.url);
    const patient = url.searchParams.get('patient');
    return HttpResponse.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        {
          resource: {
            resourceType: 'MedicationRequest',
            id: 'med-1',
            subject: { reference: `Patient/${patient}` },
            medicationCodeableConcept: {
              coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975', display: 'Metformin 500mg' }],
              text: 'Metformin 500mg',
            },
            status: 'active',
            dosageInstruction: [{ text: '500mg twice daily' }],
          },
        },
      ],
    });
  }),

  // FHIR AllergyIntolerances for a patient
  http.get(`${FHIR_BASE_URL}/AllergyIntolerance`, ({ request }) => {
    const url = new URL(request.url);
    const patient = url.searchParams.get('patient');
    return HttpResponse.json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        {
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'allergy-1',
            patient: { reference: `Patient/${patient}` },
            code: {
              coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '7980', display: 'Penicillin' }],
              text: 'Penicillin',
            },
            clinicalStatus: {
              coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
            },
          },
        },
      ],
    });
  }),

  // FHIR DocumentReference creation (write-back)
  http.post(`${FHIR_BASE_URL}/DocumentReference`, () => {
    return HttpResponse.json(
      {
        resourceType: 'DocumentReference',
        id: 'doc-ref-1',
        status: 'current',
      },
      { status: 201 }
    );
  }),
];
