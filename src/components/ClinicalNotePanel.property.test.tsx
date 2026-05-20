/**
 * @jest-environment jsdom
 */
// Feature: ambient-clinical-documentation-demo, Property 9: Clinical note and evidence map rendering completeness
// **Validates: Requirements 7.2, 7.3**

import React from 'react';
import * as fc from 'fast-check';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClinicalNotePanel } from './ClinicalNotePanel';
import { ClinicalNote, EvidenceMapping, SOAPSection } from '../types';

/**
 * Arbitrary generator for a single EvidenceMapping entry.
 * Generates both transcript and patient_context source types.
 */
const evidenceMappingArb = (index: number): fc.Arbitrary<EvidenceMapping> =>
  fc.oneof(
    // Transcript-sourced evidence
    fc.record({
      noteStatementId: fc.constant(`evidence-${index}`),
      noteStatement: fc
        .string({ minLength: 1, maxLength: 100 })
        .filter((s) => s.trim().length > 0),
      sourceType: fc.constant('transcript' as const),
      transcriptReference: fc.record({
        startTime: fc.float({ min: 0, max: 3600, noNaN: true }),
        endTime: fc.float({ min: 0, max: 3600, noNaN: true }),
        content: fc.string({ minLength: 1, maxLength: 100 }),
      }),
    }),
    // Patient context-sourced evidence
    fc.record({
      noteStatementId: fc.constant(`evidence-${index}`),
      noteStatement: fc
        .string({ minLength: 1, maxLength: 100 })
        .filter((s) => s.trim().length > 0),
      sourceType: fc.constant('patient_context' as const),
      transcriptReference: fc.constant(undefined),
    })
  );

/**
 * Arbitrary generator for a ClinicalNote with all 4 SOAP sections
 * and a variable number of evidence mappings.
 */
const clinicalNoteArb: fc.Arbitrary<ClinicalNote> = fc
  .tuple(
    // Content for each SOAP section (non-empty strings)
    fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    // Number of evidence mappings (0-5)
    fc.integer({ min: 0, max: 5 })
  )
  .chain(([subjContent, objContent, assessContent, planContent, numEvidence]) => {
    const sections: SOAPSection[] = [
      { heading: 'Subjective', content: subjContent },
      { heading: 'Objective', content: objContent },
      { heading: 'Assessment', content: assessContent },
      { heading: 'Plan', content: planContent },
    ];

    if (numEvidence === 0) {
      return fc.constant({
        sections,
        evidenceMap: [] as EvidenceMapping[],
      });
    }

    return fc
      .tuple(...Array.from({ length: numEvidence }, (_, i) => evidenceMappingArb(i)))
      .map((evidenceEntries) => ({
        sections,
        evidenceMap: evidenceEntries as EvidenceMapping[],
      }));
  });

describe('Property 9: Clinical note and evidence map rendering completeness', () => {
  it('all four SOAP section headings are rendered in the output', () => {
    fc.assert(
      fc.property(clinicalNoteArb, (clinicalNote) => {
        const { container } = render(
          <ClinicalNotePanel clinicalNote={clinicalNote} />
        );

        const expectedHeadings: SOAPSection['heading'][] = [
          'Subjective',
          'Objective',
          'Assessment',
          'Plan',
        ];

        for (const heading of expectedHeadings) {
          // Verify the section container exists via data-testid
          const sectionEl = container.querySelector(
            `[data-testid="soap-section-${heading.toLowerCase()}"]`
          );
          expect(sectionEl).not.toBeNull();

          // Verify the heading text is present
          expect(sectionEl!.textContent).toContain(heading);
        }

        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('each SOAP section content is rendered in the output', () => {
    fc.assert(
      fc.property(clinicalNoteArb, (clinicalNote) => {
        const { container } = render(
          <ClinicalNotePanel clinicalNote={clinicalNote} />
        );

        for (const section of clinicalNote.sections) {
          const sectionEl = container.querySelector(
            `[data-testid="soap-section-${section.heading.toLowerCase()}"]`
          );
          expect(sectionEl).not.toBeNull();

          // Verify the section content text is rendered
          expect(sectionEl!.textContent).toContain(section.content);
        }

        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('every evidence mapping entry is rendered with its data-testid', () => {
    fc.assert(
      fc.property(clinicalNoteArb, (clinicalNote) => {
        const { container } = render(
          <ClinicalNotePanel clinicalNote={clinicalNote} />
        );

        for (const evidence of clinicalNote.evidenceMap) {
          // Each evidence entry must be rendered with its unique data-testid
          const evidenceEl = container.querySelector(
            `[data-testid="evidence-link-${evidence.noteStatementId}"]`
          );
          expect(evidenceEl).not.toBeNull();

          // The evidence note statement text must be present
          expect(evidenceEl!.textContent).toContain(evidence.noteStatement);
        }

        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('evidence entries display their source type reference', () => {
    fc.assert(
      fc.property(clinicalNoteArb, (clinicalNote) => {
        const { container } = render(
          <ClinicalNotePanel clinicalNote={clinicalNote} />
        );

        for (const evidence of clinicalNote.evidenceMap) {
          const evidenceEl = container.querySelector(
            `[data-testid="evidence-link-${evidence.noteStatementId}"]`
          );
          expect(evidenceEl).not.toBeNull();

          // Verify the source type label is rendered
          const expectedLabel =
            evidence.sourceType === 'transcript' ? 'Transcript' : 'Patient Context';
          expect(evidenceEl!.textContent).toContain(expectedLabel);
        }

        container.remove();
      }),
      { numRuns: 100 }
    );
  });
});
