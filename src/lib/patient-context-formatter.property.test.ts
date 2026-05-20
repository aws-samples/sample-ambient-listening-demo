// Feature: ambient-clinical-documentation-demo, Property 1: Patient context priority truncation
// **Validates: Requirements 3.2**

import * as fc from 'fast-check';
import { formatPatientContext } from './patient-context-formatter';
import type {
  PatientContext,
  FHIRAllergyIntolerance,
  FHIRMedicationRequest,
  FHIRCondition,
} from '../types';

/** Maximum size of formatted patient context in bytes (10KB). */
const MAX_CONTEXT_BYTES = 10 * 1024;

/**
 * Gets the byte length of a string (UTF-8).
 */
function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generates a non-empty string suitable for names/text fields. */
const nonEmptyString = fc.string({ minLength: 1, maxLength: 100 });

/** Generates a longer string to help push data over the 10KB limit. */
const longString = fc.string({ minLength: 1, maxLength: 500 });

/** Generates a valid date string in ISO format. */
const dateString = fc.date({ min: new Date('1920-01-01'), max: new Date('2024-12-31') })
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
    text: longString,
  }),
  criticality: fc.option(fc.constantFrom('low', 'high', 'unable-to-assess'), { nil: undefined }),
  onsetDateTime: fc.option(dateString, { nil: undefined }),
});

/** Generates a FHIR MedicationRequest resource. */
const medicationArb: fc.Arbitrary<FHIRMedicationRequest> = fc.record({
  id: fc.uuid(),
  status: fc.constantFrom('active', 'on-hold', 'cancelled', 'completed', 'stopped'),
  medicationCodeableConcept: fc.record({
    text: longString,
  }),
  dosageInstruction: fc.option(
    fc.array(fc.record({ text: longString }), { minLength: 1, maxLength: 3 }),
    { nil: undefined }
  ),
});

/** Generates a FHIR Condition resource. */
const conditionArb: fc.Arbitrary<FHIRCondition> = fc.record({
  id: fc.uuid(),
  clinicalStatus: fc.constantFrom('active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'),
  code: fc.record({
    text: longString,
  }),
  onsetDateTime: fc.option(dateString, { nil: undefined }),
});

/** Generates a full PatientContext with variable-size arrays. */
const patientContextArb: fc.Arbitrary<PatientContext> = fc.record({
  demographics: demographicsArb,
  allergies: fc.array(allergyArb, { minLength: 0, maxLength: 50 }),
  medications: fc.array(medicationArb, { minLength: 0, maxLength: 50 }),
  conditions: fc.array(conditionArb, { minLength: 0, maxLength: 50 }),
});

/**
 * Generates a PatientContext that is likely to exceed 10KB when formatted,
 * to stress-test the truncation logic.
 */
const largePatientContextArb: fc.Arbitrary<PatientContext> = fc.record({
  demographics: demographicsArb,
  allergies: fc.array(allergyArb, { minLength: 20, maxLength: 80 }),
  medications: fc.array(medicationArb, { minLength: 20, maxLength: 80 }),
  conditions: fc.array(conditionArb, { minLength: 20, maxLength: 80 }),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 1: Patient context priority truncation', () => {
  it('formatted output is always ≤ 10KB (10240 bytes)', () => {
    fc.assert(
      fc.property(patientContextArb, (context) => {
        const result = formatPatientContext(context);
        const resultBytes = byteLength(result);
        expect(resultBytes).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
      }),
      { numRuns: 100 },
    );
  });

  it('formatted output is always ≤ 10KB even with large data sets', () => {
    fc.assert(
      fc.property(largePatientContextArb, (context) => {
        const result = formatPatientContext(context);
        const resultBytes = byteLength(result);
        expect(resultBytes).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
      }),
      { numRuns: 100 },
    );
  });

  it('demographics are always included in the output', () => {
    fc.assert(
      fc.property(patientContextArb, (context) => {
        const result = formatPatientContext(context);

        // Demographics section header must be present
        expect(result).toContain('=== Patient Demographics ===');
        // Key demographic fields must be present
        expect(result).toContain(`Name: ${context.demographics.name}`);
        expect(result).toContain(`Age: ${context.demographics.age}`);
        expect(result).toContain(`Sex: ${context.demographics.sex}`);
        expect(result).toContain(`Date of Birth: ${context.demographics.dateOfBirth}`);
      }),
      { numRuns: 100 },
    );
  });

  it('categories are included in priority order: demographics → allergies → medications → conditions', () => {
    fc.assert(
      fc.property(patientContextArb, (context) => {
        const result = formatPatientContext(context);

        const demographicsIdx = result.indexOf('=== Patient Demographics ===');
        const allergiesIdx = result.indexOf('=== Allergies ===');
        const medicationsIdx = result.indexOf('=== Medications ===');
        const conditionsIdx = result.indexOf('=== Conditions ===');

        // Demographics always first
        expect(demographicsIdx).toBe(0);

        // If allergies are present, they come after demographics
        if (allergiesIdx !== -1) {
          expect(allergiesIdx).toBeGreaterThan(demographicsIdx);
        }

        // If medications are present, they come after allergies (if allergies present)
        if (medicationsIdx !== -1) {
          if (allergiesIdx !== -1) {
            expect(medicationsIdx).toBeGreaterThan(allergiesIdx);
          } else {
            expect(medicationsIdx).toBeGreaterThan(demographicsIdx);
          }
        }

        // If conditions are present, they come after medications (if medications present)
        if (conditionsIdx !== -1) {
          if (medicationsIdx !== -1) {
            expect(conditionsIdx).toBeGreaterThan(medicationsIdx);
          } else if (allergiesIdx !== -1) {
            expect(conditionsIdx).toBeGreaterThan(allergiesIdx);
          } else {
            expect(conditionsIdx).toBeGreaterThan(demographicsIdx);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('a lower-priority category is only included if all higher-priority categories are fully included', () => {
    fc.assert(
      fc.property(largePatientContextArb, (context) => {
        const result = formatPatientContext(context);

        const hasAllergies = result.includes('=== Allergies ===');
        const hasMedications = result.includes('=== Medications ===');
        const hasConditions = result.includes('=== Conditions ===');

        // If medications are present, allergies must also be present (higher priority)
        if (hasMedications) {
          // Allergies must be present OR the allergies array was empty
          if (context.allergies.length > 0) {
            expect(hasAllergies).toBe(true);
          }
        }

        // If conditions are present, both allergies and medications must be present (higher priority)
        if (hasConditions) {
          if (context.allergies.length > 0) {
            expect(hasAllergies).toBe(true);
          }
          if (context.medications.length > 0) {
            expect(hasMedications).toBe(true);
          }
        }

        // If allergies section is present and has items, verify all allergy items are included
        // before medications section starts (i.e., allergies are "fully included")
        if (hasAllergies && hasMedications && context.allergies.length > 0) {
          const allergiesSection = result.substring(
            result.indexOf('=== Allergies ==='),
            result.indexOf('=== Medications ===')
          );
          // Count the number of allergy items in the section (lines starting with "- ")
          const allergyItemsInOutput = allergiesSection
            .split('\n')
            .filter((line) => line.startsWith('- ')).length;
          // All allergies must be included if the next category is present
          expect(allergyItemsInOutput).toBe(context.allergies.length);
        }

        // If medications section is present and has items, verify all medication items are included
        // before conditions section starts
        if (hasMedications && hasConditions && context.medications.length > 0) {
          const medStart = result.indexOf('=== Medications ===');
          const condStart = result.indexOf('=== Conditions ===');
          const medicationsSection = result.substring(medStart, condStart);
          const medItemsInOutput = medicationsSection
            .split('\n')
            .filter((line) => line.startsWith('- ')).length;
          expect(medItemsInOutput).toBe(context.medications.length);
        }
      }),
      { numRuns: 100 },
    );
  });
});
