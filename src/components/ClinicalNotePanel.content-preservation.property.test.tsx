/**
 * @jest-environment jsdom
 */

// Feature: clinical-note-writeback, Property 3: Content Preservation Round-Trip
// **Validates: Requirements 7.1, 4.2**

import React from 'react';
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import { ClinicalNotePanel } from './ClinicalNotePanel';
import { ClinicalNote, SOAPSection } from '../types';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/**
 * Generates arbitrary content strings including unicode, special characters,
 * and multi-line text to verify content preservation through the submission flow.
 */
const contentArb = fc.oneof(
  // Basic unicode strings
  fc.unicodeString({ minLength: 1, maxLength: 200 }),
  // Multi-line text
  fc.array(fc.unicodeString({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 5 }).map(
    (lines) => lines.join('\n')
  ),
  // Strings with special characters
  fc.stringOf(
    fc.oneof(
      fc.char(),
      fc.constant('\n'),
      fc.constant('\t'),
      fc.constant('"'),
      fc.constant("'"),
      fc.constant('<'),
      fc.constant('>'),
      fc.constant('&'),
      fc.constant('\\'),
      fc.constant('\u00e9'), // é
      fc.constant('\u2603'), // ☃
      fc.constant('\u{1F600}') // 😀
    ),
    { minLength: 1, maxLength: 150 }
  )
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createClinicalNote(sections: SOAPSection[]): ClinicalNote {
  return {
    sections,
    evidenceMap: [],
  };
}

function createDefaultSections(): SOAPSection[] {
  return [
    { heading: 'Subjective', content: 'Initial subjective content' },
    { heading: 'Objective', content: 'Initial objective content' },
    { heading: 'Assessment', content: 'Initial assessment content' },
    { heading: 'Plan', content: 'Initial plan content' },
  ];
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 3: Content Preservation Round-Trip', () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ encounterId: 1, createdAt: new Date().toISOString() }),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  it('content typed in the editor is sent exactly in the POST body', async () => {
    await fc.assert(
      fc.asyncProperty(contentArb, async (arbitraryContent) => {
        cleanup();
        fetchMock.mockClear();
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({ encounterId: 1, createdAt: new Date().toISOString() }),
        });

        const sections = createDefaultSections();
        const note = createClinicalNote(sections);

        const { container } = render(
          <ClinicalNotePanel
            clinicalNote={note}
            patientId="test-patient-uuid"
            patientName="Test Patient"
            sessionEnded={true}
          />
        );

        // Find the Subjective section textarea and change its content
        const subjectiveTextarea = container.querySelector(
          '[data-testid="soap-section-subjective"] textarea'
        ) as HTMLTextAreaElement;
        expect(subjectiveTextarea).not.toBeNull();

        // Simulate typing the arbitrary content
        await act(async () => {
          fireEvent.change(subjectiveTextarea, { target: { value: arbitraryContent } });
        });

        // Click "Submit to EMR" button
        const allButtons = Array.from(container.querySelectorAll('button'));
        const submitToEmrButton = allButtons.find(
          (btn) => btn.textContent === 'Submit to EMR'
        );
        expect(submitToEmrButton).not.toBeUndefined();

        await act(async () => {
          fireEvent.click(submitToEmrButton!);
        });

        // Click "Confirm" in the confirmation dialog
        const confirmButton = Array.from(container.querySelectorAll('button')).find(
          (btn) => btn.textContent === 'Confirm'
        );
        expect(confirmButton).not.toBeUndefined();

        await act(async () => {
          fireEvent.click(confirmButton!);
        });

        // Wait for fetch to be called
        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        // Verify the request body contains the exact content
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/encounters/create');

        const body = JSON.parse(options.body);
        const subjectiveSection = body.sections.find(
          (s: { heading: string }) => s.heading === 'Subjective'
        );
        expect(subjectiveSection).toBeDefined();
        expect(subjectiveSection.content).toBe(arbitraryContent);

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('all section contents are preserved exactly in the POST body', async () => {
    await fc.assert(
      fc.asyncProperty(
        contentArb,
        contentArb,
        contentArb,
        contentArb,
        async (subjContent, objContent, assessContent, planContent) => {
          cleanup();
          fetchMock.mockClear();
          fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ encounterId: 1, createdAt: new Date().toISOString() }),
          });

          const sections = createDefaultSections();
          const note = createClinicalNote(sections);

          const { container } = render(
            <ClinicalNotePanel
              clinicalNote={note}
              patientId="test-patient-uuid"
              patientName="Test Patient"
              sessionEnded={true}
            />
          );

          // Edit all four sections
          const textareas = container.querySelectorAll('textarea');
          expect(textareas.length).toBe(4);

          await act(async () => {
            fireEvent.change(textareas[0]!, { target: { value: subjContent } });
            fireEvent.change(textareas[1]!, { target: { value: objContent } });
            fireEvent.change(textareas[2]!, { target: { value: assessContent } });
            fireEvent.change(textareas[3]!, { target: { value: planContent } });
          });

          // Click "Submit to EMR"
          const allButtons = Array.from(container.querySelectorAll('button'));
          const submitToEmrButton = allButtons.find(
            (btn) => btn.textContent === 'Submit to EMR'
          );
          expect(submitToEmrButton).not.toBeUndefined();

          await act(async () => {
            fireEvent.click(submitToEmrButton!);
          });

          // Click "Confirm"
          const confirmButton = Array.from(container.querySelectorAll('button')).find(
            (btn) => btn.textContent === 'Confirm'
          );
          expect(confirmButton).not.toBeUndefined();

          await act(async () => {
            fireEvent.click(confirmButton!);
          });

          // Wait for fetch to be called
          await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(1);
          });

          // Verify all sections in the request body
          const [, options] = fetchMock.mock.calls[0];
          const body = JSON.parse(options.body);

          expect(body.sections).toHaveLength(4);
          expect(body.sections[0]).toEqual({ heading: 'Subjective', content: subjContent });
          expect(body.sections[1]).toEqual({ heading: 'Objective', content: objContent });
          expect(body.sections[2]).toEqual({ heading: 'Assessment', content: assessContent });
          expect(body.sections[3]).toEqual({ heading: 'Plan', content: planContent });

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('unicode and special characters are not modified or escaped in the POST body', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.unicodeString({ minLength: 1, maxLength: 300 }),
        async (unicodeContent) => {
          cleanup();
          fetchMock.mockClear();
          fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ encounterId: 1, createdAt: new Date().toISOString() }),
          });

          const sections: SOAPSection[] = [
            { heading: 'Subjective', content: 'placeholder' },
            { heading: 'Objective', content: 'placeholder' },
            { heading: 'Assessment', content: 'placeholder' },
            { heading: 'Plan', content: 'placeholder' },
          ];
          const note = createClinicalNote(sections);

          const { container } = render(
            <ClinicalNotePanel
              clinicalNote={note}
              patientId="test-patient-uuid"
              patientName="Test Patient"
              sessionEnded={true}
            />
          );

          // Edit the Assessment section with unicode content
          const textareas = container.querySelectorAll('textarea');
          const assessmentTextarea = textareas[2]!;

          await act(async () => {
            fireEvent.change(assessmentTextarea, { target: { value: unicodeContent } });
          });

          // Submit flow
          const allButtons = Array.from(container.querySelectorAll('button'));
          const submitToEmrButton = allButtons.find(
            (btn) => btn.textContent === 'Submit to EMR'
          );

          await act(async () => {
            fireEvent.click(submitToEmrButton!);
          });

          const confirmButton = Array.from(container.querySelectorAll('button')).find(
            (btn) => btn.textContent === 'Confirm'
          );

          await act(async () => {
            fireEvent.click(confirmButton!);
          });

          await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(1);
          });

          // Verify the unicode content is preserved exactly
          const [, options] = fetchMock.mock.calls[0];
          const body = JSON.parse(options.body);
          const assessmentSection = body.sections.find(
            (s: { heading: string }) => s.heading === 'Assessment'
          );
          expect(assessmentSection.content).toBe(unicodeContent);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});
