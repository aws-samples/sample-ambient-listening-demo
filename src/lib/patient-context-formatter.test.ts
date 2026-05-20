/**
 * Unit tests for patient context formatter with priority truncation.
 *
 * @see Requirements 3.2
 */

import { formatPatientContext } from './patient-context-formatter';
import type {
  PatientContext,
  FHIRAllergyIntolerance,
  FHIRMedicationRequest,
  FHIRCondition,
} from '../types';

const MAX_CONTEXT_BYTES = 10 * 1024; // 10KB

function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function makeAllergy(overrides: Partial<FHIRAllergyIntolerance> = {}): FHIRAllergyIntolerance {
  return {
    id: 'allergy-1',
    clinicalStatus: 'active',
    code: { text: 'Penicillin' },
    criticality: 'high',
    ...overrides,
  };
}

function makeMedication(overrides: Partial<FHIRMedicationRequest> = {}): FHIRMedicationRequest {
  return {
    id: 'med-1',
    status: 'active',
    medicationCodeableConcept: { text: 'Lisinopril 10mg' },
    dosageInstruction: [{ text: 'Take once daily' }],
    ...overrides,
  };
}

function makeCondition(overrides: Partial<FHIRCondition> = {}): FHIRCondition {
  return {
    id: 'cond-1',
    clinicalStatus: 'active',
    code: { text: 'Hypertension' },
    onsetDateTime: '2020-01-15',
    ...overrides,
  };
}

function makeContext(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    demographics: {
      name: 'John Smith',
      age: 45,
      sex: 'Male',
      dateOfBirth: '1979-03-15',
    },
    allergies: [],
    medications: [],
    conditions: [],
    ...overrides,
  };
}

describe('formatPatientContext', () => {
  describe('basic formatting', () => {
    it('should format demographics only when no other data is present', () => {
      const context = makeContext();
      const result = formatPatientContext(context);

      expect(result).toContain('=== Patient Demographics ===');
      expect(result).toContain('Name: John Smith');
      expect(result).toContain('Age: 45');
      expect(result).toContain('Sex: Male');
      expect(result).toContain('Date of Birth: 1979-03-15');
    });

    it('should include all categories when data fits within 10KB', () => {
      const context = makeContext({
        allergies: [makeAllergy()],
        medications: [makeMedication()],
        conditions: [makeCondition()],
      });
      const result = formatPatientContext(context);

      expect(result).toContain('=== Patient Demographics ===');
      expect(result).toContain('=== Allergies ===');
      expect(result).toContain('Penicillin');
      expect(result).toContain('=== Medications ===');
      expect(result).toContain('Lisinopril 10mg');
      expect(result).toContain('=== Conditions ===');
      expect(result).toContain('Hypertension');
    });

    it('should format allergies with clinical status and criticality', () => {
      const context = makeContext({
        allergies: [makeAllergy({ clinicalStatus: 'active', criticality: 'high' })],
      });
      const result = formatPatientContext(context);

      expect(result).toContain('- Penicillin (active) [high]');
    });

    it('should format medications with status and dosage', () => {
      const context = makeContext({
        medications: [makeMedication()],
      });
      const result = formatPatientContext(context);

      expect(result).toContain('- Lisinopril 10mg (active) — Take once daily');
    });

    it('should format conditions with clinical status and onset', () => {
      const context = makeContext({
        conditions: [makeCondition()],
      });
      const result = formatPatientContext(context);

      expect(result).toContain('- Hypertension (active) onset: 2020-01-15');
    });
  });

  describe('size constraint', () => {
    it('should never exceed 10KB', () => {
      const context = makeContext({
        allergies: Array.from({ length: 100 }, (_, i) =>
          makeAllergy({ id: `allergy-${i}`, code: { text: `Allergy ${i} - ${'x'.repeat(50)}` } })
        ),
        medications: Array.from({ length: 100 }, (_, i) =>
          makeMedication({
            id: `med-${i}`,
            medicationCodeableConcept: { text: `Medication ${i} - ${'y'.repeat(50)}` },
          })
        ),
        conditions: Array.from({ length: 100 }, (_, i) =>
          makeCondition({ id: `cond-${i}`, code: { text: `Condition ${i} - ${'z'.repeat(50)}` } })
        ),
      });
      const result = formatPatientContext(context);

      expect(byteLength(result)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    });

    it('should always include demographics even if they are large', () => {
      const context = makeContext({
        demographics: {
          name: 'A'.repeat(500),
          age: 99,
          sex: 'Male',
          dateOfBirth: '1925-01-01',
        },
        allergies: Array.from({ length: 200 }, (_, i) =>
          makeAllergy({ id: `a-${i}`, code: { text: `Allergy ${'x'.repeat(100)}` } })
        ),
      });
      const result = formatPatientContext(context);

      expect(result).toContain('=== Patient Demographics ===');
      expect(result).toContain('A'.repeat(500));
    });
  });

  describe('priority truncation', () => {
    it('should maintain priority order: demographics → allergies → medications → conditions', () => {
      const context = makeContext({
        allergies: [makeAllergy()],
        medications: [makeMedication()],
        conditions: [makeCondition()],
      });
      const result = formatPatientContext(context);

      const demoIdx = result.indexOf('=== Patient Demographics ===');
      const allergyIdx = result.indexOf('=== Allergies ===');
      const medIdx = result.indexOf('=== Medications ===');
      const condIdx = result.indexOf('=== Conditions ===');

      expect(demoIdx).toBeLessThan(allergyIdx);
      expect(allergyIdx).toBeLessThan(medIdx);
      expect(medIdx).toBeLessThan(condIdx);
    });

    it('should include partial items from a category when full category does not fit', () => {
      // Create a context where allergies partially fit
      const largeAllergies = Array.from({ length: 200 }, (_, i) =>
        makeAllergy({ id: `a-${i}`, code: { text: `Severe Allergy Number ${i} - ${'x'.repeat(30)}` } })
      );
      const context = makeContext({
        allergies: largeAllergies,
        medications: [makeMedication()],
      });
      const result = formatPatientContext(context);

      // Should have some allergies but not all
      expect(result).toContain('=== Allergies ===');
      const allergyMatches = result.match(/- Severe Allergy Number/g);
      expect(allergyMatches).not.toBeNull();
      expect(allergyMatches!.length).toBeGreaterThan(0);
      expect(allergyMatches!.length).toBeLessThan(200);

      // Should not exceed 10KB
      expect(byteLength(result)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    });

    it('should drop lower-priority categories when higher-priority ones fill the space', () => {
      // Fill up with allergies so medications and conditions are dropped
      const manyAllergies = Array.from({ length: 200 }, (_, i) =>
        makeAllergy({ id: `a-${i}`, code: { text: `Allergy ${i} with long description ${'x'.repeat(40)}` } })
      );
      const context = makeContext({
        allergies: manyAllergies,
        medications: [makeMedication()],
        conditions: [makeCondition()],
      });
      const result = formatPatientContext(context);

      expect(result).toContain('=== Patient Demographics ===');
      expect(result).toContain('=== Allergies ===');
      // Medications and conditions should be dropped due to space
      expect(byteLength(result)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    });
  });

  describe('edge cases', () => {
    it('should handle empty arrays for all categories', () => {
      const context = makeContext();
      const result = formatPatientContext(context);

      expect(result).toContain('=== Patient Demographics ===');
      expect(result).not.toContain('=== Allergies ===');
      expect(result).not.toContain('=== Medications ===');
      expect(result).not.toContain('=== Conditions ===');
    });

    it('should handle allergies without criticality', () => {
      const context = makeContext({
        allergies: [makeAllergy({ criticality: undefined })],
      });
      const result = formatPatientContext(context);

      expect(result).toContain('- Penicillin (active)');
      expect(result).not.toContain('[');
    });

    it('should handle medications without dosage instructions', () => {
      const context = makeContext({
        medications: [makeMedication({ dosageInstruction: undefined })],
      });
      const result = formatPatientContext(context);

      expect(result).toContain('- Lisinopril 10mg (active)');
      expect(result).not.toContain('—');
    });

    it('should handle conditions without onset date', () => {
      const context = makeContext({
        conditions: [makeCondition({ onsetDateTime: undefined })],
      });
      const result = formatPatientContext(context);

      expect(result).toContain('- Hypertension (active)');
      expect(result).not.toContain('onset:');
    });
  });
});
