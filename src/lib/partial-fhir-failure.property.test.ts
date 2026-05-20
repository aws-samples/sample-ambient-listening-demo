// Feature: ambient-clinical-documentation-demo, Property 2: Partial FHIR failure handling
// **Validates: Requirements 3.5**

import * as fc from 'fast-check';
import {
  processPatientDataResult,
  type FHIRResourceType,
} from './patient-context-formatter';
import type { PatientDataResult, FHIRFetchResult } from './fhir-client';
import type {
  PatientContext,
  FHIRAllergyIntolerance,
  FHIRMedicationRequest,
  FHIRCondition,
} from '../types';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generates a non-empty string suitable for names/text fields. */
const nonEmptyString = fc.string({ minLength: 1, maxLength: 80 });

/** Generates a valid date string in ISO format. */
const dateString = fc
  .date({ min: new Date('1920-01-01'), max: new Date('2024-12-31') })
  .map((d) => d.toISOString().split('T')[0]);

/** Generates patient demographics. */
const demographicsArb = fc.record({
  name: nonEmptyString,
  age: fc.integer({ min: 0, max: 120 }),
  sex: fc.constantFrom('Male', 'Female', 'Other', 'Unknown'),
  dateOfBirth: dateString,
});

/** Generates a FHIR AllergyIntolerance resource. */
const allergyArb: fc.Arbitrary<FHIRAllergyIntolerance> = fc.record({
  id: fc.uuid(),
  clinicalStatus: fc.constantFrom('active', 'inactive', 'resolved'),
  code: fc.record({
    text: nonEmptyString,
  }),
  criticality: fc.option(fc.constantFrom('low', 'high', 'unable-to-assess'), {
    nil: undefined,
  }),
  onsetDateTime: fc.option(dateString, { nil: undefined }),
});

/** Generates a FHIR MedicationRequest resource. */
const medicationArb: fc.Arbitrary<FHIRMedicationRequest> = fc.record({
  id: fc.uuid(),
  status: fc.constantFrom('active', 'on-hold', 'cancelled', 'completed', 'stopped'),
  medicationCodeableConcept: fc.record({
    text: nonEmptyString,
  }),
  dosageInstruction: fc.option(
    fc.array(fc.record({ text: nonEmptyString }), { minLength: 1, maxLength: 2 }),
    { nil: undefined }
  ),
});

/** Generates a FHIR Condition resource. */
const conditionArb: fc.Arbitrary<FHIRCondition> = fc.record({
  id: fc.uuid(),
  clinicalStatus: fc.constantFrom('active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'),
  code: fc.record({
    text: nonEmptyString,
  }),
  onsetDateTime: fc.option(dateString, { nil: undefined }),
});

/** Generates a successful FHIRFetchResult for allergies. */
const successfulAllergiesArb: fc.Arbitrary<FHIRFetchResult<FHIRAllergyIntolerance[]>> = fc
  .array(allergyArb, { minLength: 0, maxLength: 10 })
  .map((data) => ({ success: true, data }));

/** Generates a failed FHIRFetchResult for allergies. */
const failedAllergiesArb: fc.Arbitrary<FHIRFetchResult<FHIRAllergyIntolerance[]>> = fc
  .string({ minLength: 5, maxLength: 50 })
  .map((error) => ({ success: false, error }));

/** Generates a successful FHIRFetchResult for medications. */
const successfulMedicationsArb: fc.Arbitrary<FHIRFetchResult<FHIRMedicationRequest[]>> = fc
  .array(medicationArb, { minLength: 0, maxLength: 10 })
  .map((data) => ({ success: true, data }));

/** Generates a failed FHIRFetchResult for medications. */
const failedMedicationsArb: fc.Arbitrary<FHIRFetchResult<FHIRMedicationRequest[]>> = fc
  .string({ minLength: 5, maxLength: 50 })
  .map((error) => ({ success: false, error }));

/** Generates a successful FHIRFetchResult for conditions. */
const successfulConditionsArb: fc.Arbitrary<FHIRFetchResult<FHIRCondition[]>> = fc
  .array(conditionArb, { minLength: 0, maxLength: 10 })
  .map((data) => ({ success: true, data }));

/** Generates a failed FHIRFetchResult for conditions. */
const failedConditionsArb: fc.Arbitrary<FHIRFetchResult<FHIRCondition[]>> = fc
  .string({ minLength: 5, maxLength: 50 })
  .map((error) => ({ success: false, error }));

/**
 * The three resource types that can independently succeed or fail.
 * We need at least one success and at least one failure for the partial failure scenario.
 */
const RESOURCE_TYPES: FHIRResourceType[] = ['allergies', 'medications', 'conditions'];

/**
 * Generates a non-empty subset of resource types to mark as failed.
 * Ensures at least one type fails and at least one succeeds (partial failure).
 */
const failedSubsetArb: fc.Arbitrary<Set<FHIRResourceType>> = fc
  .subarray(RESOURCE_TYPES, { minLength: 1, maxLength: 2 })
  .map((arr) => new Set(arr));

/**
 * Generates a PatientDataResult with partial failures based on the failed subset.
 * Patient resource always succeeds (it's required for demographics).
 */
function patientDataResultArb(
  failedTypes: Set<FHIRResourceType>
): fc.Arbitrary<PatientDataResult> {
  const allergiesArb = failedTypes.has('allergies')
    ? failedAllergiesArb
    : successfulAllergiesArb;
  const medicationsArb = failedTypes.has('medications')
    ? failedMedicationsArb
    : successfulMedicationsArb;
  const conditionsArb = failedTypes.has('conditions')
    ? failedConditionsArb
    : successfulConditionsArb;

  return fc.record({
    patient: fc.record({
      success: fc.constant(true as const),
      data: fc.record({
        resourceType: fc.constant('Patient' as const),
        id: fc.uuid(),
        gender: fc.constantFrom('male', 'female', 'other', 'unknown'),
      }),
    }),
    allergies: allergiesArb,
    medications: medicationsArb,
    conditions: conditionsArb,
  }) as fc.Arbitrary<PatientDataResult>;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 2: Partial FHIR failure handling', () => {
  it('warning lists exactly the resource types that failed', () => {
    fc.assert(
      fc.property(
        failedSubsetArb,
        demographicsArb,
        (failedTypes, demographics) => {
          return fc.assert(
            fc.property(
              patientDataResultArb(failedTypes),
              (dataResult) => {
                const result = processPatientDataResult(dataResult, demographics);

                // Warning must be non-null when there are failures
                expect(result.warning).not.toBeNull();

                // The warning must list exactly the failed resource types
                expect(result.failedResourceTypes.sort()).toEqual(
                  Array.from(failedTypes).sort()
                );

                // Each failed type must appear in the warning message
                for (const failedType of failedTypes) {
                  expect(result.warning).toContain(failedType);
                }

                // No successful type should appear in the failed list
                for (const successType of result.successfulResourceTypes) {
                  expect(failedTypes.has(successType)).toBe(false);
                }
              }
            ),
            { numRuns: 10 }
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  it('formatted context includes all data from successful resource types', () => {
    fc.assert(
      fc.property(
        failedSubsetArb,
        demographicsArb,
        (failedTypes, demographics) => {
          return fc.assert(
            fc.property(
              patientDataResultArb(failedTypes),
              (dataResult) => {
                const result = processPatientDataResult(dataResult, demographics);

                // Demographics are always included
                expect(result.formattedContext).toContain(demographics.name);
                expect(result.formattedContext).toContain(`Age: ${demographics.age}`);

                // Successful allergies data should be in the formatted context
                if (dataResult.allergies.success && dataResult.allergies.data) {
                  for (const allergy of dataResult.allergies.data) {
                    expect(result.formattedContext).toContain(allergy.code.text);
                  }
                }

                // Successful medications data should be in the formatted context
                if (dataResult.medications.success && dataResult.medications.data) {
                  for (const med of dataResult.medications.data) {
                    expect(result.formattedContext).toContain(
                      med.medicationCodeableConcept.text
                    );
                  }
                }

                // Successful conditions data should be in the formatted context
                if (dataResult.conditions.success && dataResult.conditions.data) {
                  for (const condition of dataResult.conditions.data) {
                    expect(result.formattedContext).toContain(condition.code.text);
                  }
                }
              }
            ),
            { numRuns: 10 }
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  it('failed resource types do NOT contribute data to the formatted context', () => {
    fc.assert(
      fc.property(
        failedSubsetArb,
        demographicsArb,
        (failedTypes, demographics) => {
          return fc.assert(
            fc.property(
              patientDataResultArb(failedTypes),
              (dataResult) => {
                const result = processPatientDataResult(dataResult, demographics);

                // If allergies failed, the Allergies section should not appear
                if (failedTypes.has('allergies')) {
                  expect(result.formattedContext).not.toContain('=== Allergies ===');
                }

                // If medications failed, the Medications section should not appear
                if (failedTypes.has('medications')) {
                  expect(result.formattedContext).not.toContain('=== Medications ===');
                }

                // If conditions failed, the Conditions section should not appear
                if (failedTypes.has('conditions')) {
                  expect(result.formattedContext).not.toContain('=== Conditions ===');
                }
              }
            ),
            { numRuns: 10 }
          );
        }
      ),
      { numRuns: 10 }
    );
  });

  it('successful + failed resource types together account for all resource types', () => {
    fc.assert(
      fc.property(
        failedSubsetArb,
        demographicsArb,
        (failedTypes, demographics) => {
          return fc.assert(
            fc.property(
              patientDataResultArb(failedTypes),
              (dataResult) => {
                const result = processPatientDataResult(dataResult, demographics);

                // The union of successful and failed types must equal all resource types
                const allTypes = new Set([
                  ...result.successfulResourceTypes,
                  ...result.failedResourceTypes,
                ]);
                expect(allTypes).toEqual(new Set(RESOURCE_TYPES));

                // No overlap between successful and failed
                for (const t of result.successfulResourceTypes) {
                  expect(result.failedResourceTypes).not.toContain(t);
                }
              }
            ),
            { numRuns: 10 }
          );
        }
      ),
      { numRuns: 10 }
    );
  });
});
