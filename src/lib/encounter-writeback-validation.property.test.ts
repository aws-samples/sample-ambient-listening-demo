// Feature: clinical-note-writeback, Property 5: Request Validation Rejects Invalid Input
// **Validates: Requirements 6.2, 6.3**

import * as fc from 'fast-check';
import { validateCreateEncounterRequest } from './encounter-writeback-validation';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generates values that are not valid non-empty strings (missing patientId scenarios). */
const invalidPatientIdArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('\t\n'),
  fc.constantFrom(0, 123, false, true, [], {}),
);

/** Generates section arrays where all sections have empty or whitespace-only content. */
const allEmptySectionsArb = fc.array(
  fc.record({
    heading: fc.constantFrom('Subjective', 'Objective', 'Assessment', 'Plan'),
    content: fc.oneof(
      fc.constant(''),
      fc.constant('   '),
      fc.constant('\t'),
      fc.constant('\n'),
      fc.constant('  \n  \t  '),
    ),
  }),
  { minLength: 0, maxLength: 4 }
);

/** Generates invalid sections values (not arrays, missing, etc.). */
const invalidSectionsArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant('not an array'),
  fc.constant(123),
  fc.constant({}),
);

/** Generates a valid non-empty patientId. */
const validPatientIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter(
  (s) => s.trim().length > 0
);

/** Generates a valid sections array with at least one non-empty section. */
const validSectionsArb = fc
  .array(
    fc.record({
      heading: fc.constantFrom('Subjective', 'Objective', 'Assessment', 'Plan'),
      content: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    }),
    { minLength: 1, maxLength: 4 }
  );

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 5: Request Validation Rejects Invalid Input', () => {
  it('rejects requests with missing or invalid patientId', () => {
    fc.assert(
      fc.property(
        invalidPatientIdArb,
        validSectionsArb,
        (patientId, sections) => {
          const result = validateCreateEncounterRequest({ patientId, sections });

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeDefined();
            expect(result.error.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects requests with zero non-empty sections', () => {
    fc.assert(
      fc.property(
        validPatientIdArb,
        allEmptySectionsArb,
        (patientId, sections) => {
          const result = validateCreateEncounterRequest({ patientId, sections });

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeDefined();
            expect(result.error.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects requests with invalid sections field (not an array)', () => {
    fc.assert(
      fc.property(
        validPatientIdArb,
        invalidSectionsArb,
        (patientId, sections) => {
          const result = validateCreateEncounterRequest({ patientId, sections });

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeDefined();
            expect(result.error.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts requests with valid patientId and at least one non-empty section', () => {
    fc.assert(
      fc.property(
        validPatientIdArb,
        validSectionsArb,
        (patientId, sections) => {
          const result = validateCreateEncounterRequest({ patientId, sections });

          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects null or undefined request bodies', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined),
        (body) => {
          const result = validateCreateEncounterRequest(body);

          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.error).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
