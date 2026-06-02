/**
 * @jest-environment jsdom
 */

// Feature: clinical-note-writeback, Property 1: Edit Preservation Across Section Switches
// **Validates: Requirements 1.2**

import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import { ClinicalNotePanel } from './ClinicalNotePanel';
import { ClinicalNote, SOAPSection } from '../types';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** The four SOAP section headings. */
const SOAP_HEADINGS: SOAPSection['heading'][] = ['Subjective', 'Objective', 'Assessment', 'Plan'];

/**
 * Generates non-empty content strings for editing.
 * Includes alphanumeric, spaces, newlines, and common punctuation.
 * Avoids control characters that could interfere with textarea behavior.
 */
const editContentArb = fc.stringOf(
  fc.char().filter((c) => {
    const code = c.charCodeAt(0);
    // Allow printable ASCII + newlines + tabs, exclude NUL and other control chars
    return (code >= 32 && code <= 126) || code === 10 || code === 9;
  }),
  { minLength: 1, maxLength: 200 }
);

/**
 * Generates a SOAP heading to target for editing.
 */
const soapHeadingArb = fc.constantFrom(...SOAP_HEADINGS);

/**
 * Generates a sequence of edit operations: pairs of (section heading, new content).
 * This simulates a provider editing multiple sections in sequence.
 */
const editSequenceArb = fc.array(
  fc.tuple(soapHeadingArb, editContentArb),
  { minLength: 2, maxLength: 8 }
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a ClinicalNote with all four SOAP sections and default content. */
function createTestClinicalNote(): ClinicalNote {
  return {
    sections: SOAP_HEADINGS.map((heading) => ({
      heading,
      content: `Default content for ${heading}`,
    })),
    evidenceMap: [],
  };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 1: Edit Preservation Across Section Switches', () => {
  afterEach(() => {
    cleanup();
  });

  it('editing a section, switching to another, then switching back preserves the edit exactly', () => {
    fc.assert(
      fc.property(
        editContentArb,
        soapHeadingArb,
        soapHeadingArb.filter((_h) => true), // second heading (may be same or different)
        (editContent, firstSection, secondSection) => {
          // Skip if both sections are the same — we need to switch away and back
          fc.pre(firstSection !== secondSection);

          cleanup();

          const clinicalNote = createTestClinicalNote();

          const { container } = render(
            <ClinicalNotePanel
              clinicalNote={clinicalNote}
              sessionEnded={true}
              patientId="test-patient-id"
              patientName="Test Patient"
            />
          );

          // Find the textarea for the first section and edit it
          const firstTextarea = container.querySelector(
            `[data-testid="soap-section-${firstSection.toLowerCase()}"] textarea`
          ) as HTMLTextAreaElement;
          expect(firstTextarea).not.toBeNull();

          // Simulate editing the first section
          fireEvent.change(firstTextarea, { target: { value: editContent } });

          // Verify the edit was applied
          expect(firstTextarea.value).toBe(editContent);

          // Now "switch" to the second section by editing it
          const secondTextarea = container.querySelector(
            `[data-testid="soap-section-${secondSection.toLowerCase()}"] textarea`
          ) as HTMLTextAreaElement;
          expect(secondTextarea).not.toBeNull();

          fireEvent.change(secondTextarea, { target: { value: 'Some other edit' } });

          // Switch back to the first section — verify the original edit is preserved
          const firstTextareaAfter = container.querySelector(
            `[data-testid="soap-section-${firstSection.toLowerCase()}"] textarea`
          ) as HTMLTextAreaElement;

          expect(firstTextareaAfter.value).toBe(editContent);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('a sequence of edits across multiple sections preserves all edits', () => {
    fc.assert(
      fc.property(editSequenceArb, (editSequence) => {
        cleanup();

        const clinicalNote = createTestClinicalNote();

        const { container } = render(
          <ClinicalNotePanel
            clinicalNote={clinicalNote}
            sessionEnded={true}
            patientId="test-patient-id"
            patientName="Test Patient"
          />
        );

        // Track the last edit made to each section
        const lastEditPerSection: Record<string, string> = {};

        // Apply all edits in sequence
        for (const [heading, content] of editSequence) {
          const textarea = container.querySelector(
            `[data-testid="soap-section-${heading.toLowerCase()}"] textarea`
          ) as HTMLTextAreaElement;
          expect(textarea).not.toBeNull();

          fireEvent.change(textarea, { target: { value: content } });
          lastEditPerSection[heading] = content;
        }

        // Verify that each section's textarea reflects the last edit made to it
        for (const [heading, expectedContent] of Object.entries(lastEditPerSection)) {
          const textarea = container.querySelector(
            `[data-testid="soap-section-${heading.toLowerCase()}"] textarea`
          ) as HTMLTextAreaElement;

          expect(textarea.value).toBe(expectedContent);
        }

        // Verify sections that were NOT edited still have their original content
        for (const heading of SOAP_HEADINGS) {
          if (!(heading in lastEditPerSection)) {
            const textarea = container.querySelector(
              `[data-testid="soap-section-${heading.toLowerCase()}"] textarea`
            ) as HTMLTextAreaElement;

            expect(textarea.value).toBe(`Default content for ${heading}`);
          }
        }

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('editing all four sections and reading them back preserves each edit independently', () => {
    fc.assert(
      fc.property(
        editContentArb,
        editContentArb,
        editContentArb,
        editContentArb,
        (subjectiveEdit, objectiveEdit, assessmentEdit, planEdit) => {
          cleanup();

          const clinicalNote = createTestClinicalNote();
          const edits: Record<string, string> = {
            Subjective: subjectiveEdit,
            Objective: objectiveEdit,
            Assessment: assessmentEdit,
            Plan: planEdit,
          };

          const { container } = render(
            <ClinicalNotePanel
              clinicalNote={clinicalNote}
              sessionEnded={true}
              patientId="test-patient-id"
              patientName="Test Patient"
            />
          );

          // Edit all four sections
          for (const heading of SOAP_HEADINGS) {
            const textarea = container.querySelector(
              `[data-testid="soap-section-${heading.toLowerCase()}"] textarea`
            ) as HTMLTextAreaElement;
            expect(textarea).not.toBeNull();

            fireEvent.change(textarea, { target: { value: edits[heading] } });
          }

          // Verify all four sections preserved their edits
          for (const heading of SOAP_HEADINGS) {
            const textarea = container.querySelector(
              `[data-testid="soap-section-${heading.toLowerCase()}"] textarea`
            ) as HTMLTextAreaElement;

            expect(textarea.value).toBe(edits[heading]);
          }

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});
