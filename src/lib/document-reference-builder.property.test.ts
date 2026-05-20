// Feature: ambient-clinical-documentation-demo, Property 13: DocumentReference structure completeness
// **Validates: Requirements 14.2**

import * as fc from 'fast-check';
import { buildDocumentReference } from './document-reference-builder';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generates non-empty clinical note content including special characters, multi-line, and unicode. */
const clinicalNoteContentArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 500 }),
  fc.unicodeString({ minLength: 1, maxLength: 300 }),
  fc.array(fc.string({ minLength: 1, maxLength: 80 }), { minLength: 1, maxLength: 10 }).map(
    (lines) => lines.join('\n')
  )
);

/** Generates non-empty patient IDs. */
const patientIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/** Generates session dates as Date objects. */
const sessionDateAsDateArb = fc.date({
  min: new Date('1970-01-01T00:00:00.000Z'),
  max: new Date('2099-12-31T23:59:59.999Z'),
});

/** Generates session dates as ISO strings. */
const sessionDateAsStringArb = sessionDateAsDateArb.map((d) => d.toISOString());

/** Generates session dates as either Date objects or ISO strings. */
const sessionDateArb = fc.oneof(sessionDateAsDateArb, sessionDateAsStringArb);

/** ISO 8601 date-time regex pattern. */
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 13: DocumentReference structure completeness', () => {
  it('generated DocumentReference has correct resourceType and status', () => {
    fc.assert(
      fc.property(
        clinicalNoteContentArb,
        patientIdArb,
        sessionDateArb,
        (noteContent, patientId, sessionDate) => {
          const result = buildDocumentReference({
            clinicalNoteContent: noteContent,
            patientId,
            sessionDate,
          });

          expect(result.resourceType).toBe('DocumentReference');
          expect(result.status).toBe('current');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generated DocumentReference has LOINC type coding for progress note', () => {
    fc.assert(
      fc.property(
        clinicalNoteContentArb,
        patientIdArb,
        sessionDateArb,
        (noteContent, patientId, sessionDate) => {
          const result = buildDocumentReference({
            clinicalNoteContent: noteContent,
            patientId,
            sessionDate,
          });

          expect(result.type.coding).toHaveLength(1);
          expect(result.type.coding[0].system).toBe('http://loinc.org');
          expect(result.type.coding[0].code).toBe('11506-3');
          expect(result.type.coding[0].display).toBe('Progress note');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generated DocumentReference has correct subject reference to patient', () => {
    fc.assert(
      fc.property(
        clinicalNoteContentArb,
        patientIdArb,
        sessionDateArb,
        (noteContent, patientId, sessionDate) => {
          const result = buildDocumentReference({
            clinicalNoteContent: noteContent,
            patientId,
            sessionDate,
          });

          expect(result.subject.reference).toBe(`Patient/${patientId}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generated DocumentReference has a valid ISO 8601 date string', () => {
    fc.assert(
      fc.property(
        clinicalNoteContentArb,
        patientIdArb,
        sessionDateArb,
        (noteContent, patientId, sessionDate) => {
          const result = buildDocumentReference({
            clinicalNoteContent: noteContent,
            patientId,
            sessionDate,
          });

          expect(result.date).toMatch(ISO_8601_REGEX);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generated DocumentReference description contains "Ambient Clinical Note"', () => {
    fc.assert(
      fc.property(
        clinicalNoteContentArb,
        patientIdArb,
        sessionDateArb,
        (noteContent, patientId, sessionDate) => {
          const result = buildDocumentReference({
            clinicalNoteContent: noteContent,
            patientId,
            sessionDate,
          });

          expect(result.description).toContain('Ambient Clinical Note');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generated DocumentReference has exactly one content entry with text/plain attachment', () => {
    fc.assert(
      fc.property(
        clinicalNoteContentArb,
        patientIdArb,
        sessionDateArb,
        (noteContent, patientId, sessionDate) => {
          const result = buildDocumentReference({
            clinicalNoteContent: noteContent,
            patientId,
            sessionDate,
          });

          expect(result.content).toHaveLength(1);
          expect(result.content[0].attachment.contentType).toBe('text/plain');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('base64-encoded data decodes back to the original clinical note content', () => {
    fc.assert(
      fc.property(
        clinicalNoteContentArb,
        patientIdArb,
        sessionDateArb,
        (noteContent, patientId, sessionDate) => {
          const result = buildDocumentReference({
            clinicalNoteContent: noteContent,
            patientId,
            sessionDate,
          });

          const decoded = Buffer.from(
            result.content[0].attachment.data,
            'base64'
          ).toString('utf-8');
          expect(decoded).toBe(noteContent);
        }
      ),
      { numRuns: 100 }
    );
  });
});
