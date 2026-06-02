/**
 * @jest-environment jsdom
 */
// Feature: clinical-note-writeback, Property 10: Retry Sends Identical Content
// **Validates: Requirements 5.4**

import React from 'react';
import * as fc from 'fast-check';
import { render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClinicalNotePanel } from './ClinicalNotePanel';
import { ClinicalNote } from '../types';

/**
 * Arbitrary generator for SOAP section content strings.
 * Generates non-empty strings that can include unicode and special characters.
 */
const soapContentArb = fc.string({ minLength: 1, maxLength: 120 }).filter(
  (s) => s.trim().length > 0
);

/**
 * Arbitrary generator for a ClinicalNote with all 4 SOAP sections.
 */
const clinicalNoteArb: fc.Arbitrary<ClinicalNote> = fc
  .tuple(soapContentArb, soapContentArb, soapContentArb, soapContentArb)
  .map(([subj, obj, assess, plan]) => ({
    sections: [
      { heading: 'Subjective' as const, content: subj },
      { heading: 'Objective' as const, content: obj },
      { heading: 'Assessment' as const, content: assess },
      { heading: 'Plan' as const, content: plan },
    ],
    evidenceMap: [],
  }));

/**
 * Arbitrary generator for edited content that will be typed into the textareas.
 * Generates a record of section heading → new content.
 */
const editedContentArb = fc
  .tuple(soapContentArb, soapContentArb, soapContentArb, soapContentArb)
  .map(([subj, obj, assess, plan]) => ({
    Subjective: subj,
    Objective: obj,
    Assessment: assess,
    Plan: plan,
  }));

describe('Property 10: Retry Sends Identical Content', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retry sends byte-identical request body as the original failed submission', async () => {
    await fc.assert(
      fc.asyncProperty(clinicalNoteArb, editedContentArb, async (clinicalNote, editedContent) => {
        // Reset mock for each iteration
        fetchMock.mockReset();

        // First call fails, second call succeeds
        fetchMock
          .mockResolvedValueOnce({
            ok: false,
            json: () => Promise.resolve({ error: 'Server error' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ encounterId: 123, createdAt: new Date().toISOString() }),
          });

        const { container, unmount } = render(
          <ClinicalNotePanel
            clinicalNote={clinicalNote}
            sessionEnded={true}
            patientId="test-patient-uuid"
            patientName="Test Patient"
          />
        );

        // Type edited content into each section textarea
        const headings: Array<'Subjective' | 'Objective' | 'Assessment' | 'Plan'> = [
          'Subjective',
          'Objective',
          'Assessment',
          'Plan',
        ];

        for (const heading of headings) {
          const textarea = container.querySelector(
            `textarea[aria-label="Edit ${heading} section"]`
          ) as HTMLTextAreaElement;
          expect(textarea).not.toBeNull();
          fireEvent.change(textarea, { target: { value: editedContent[heading] } });
        }

        // Click "Submit to EMR" button
        let submitBtn: HTMLButtonElement | null = null;
        container.querySelectorAll('button').forEach((btn) => {
          if (btn.textContent === 'Submit to EMR') {
            submitBtn = btn as HTMLButtonElement;
          }
        });
        expect(submitBtn).not.toBeNull();
        fireEvent.click(submitBtn!);

        // Click "Confirm" in the confirmation dialog
        let confirmBtn: HTMLButtonElement | null = null;
        container.querySelectorAll('button').forEach((btn) => {
          if (btn.textContent === 'Confirm') {
            confirmBtn = btn as HTMLButtonElement;
          }
        });
        expect(confirmBtn).not.toBeNull();
        fireEvent.click(confirmBtn!);

        // Wait for the first fetch call to complete (fails)
        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        // Capture the first request body
        const firstCallBody = fetchMock.mock.calls[0][1]?.body;

        // Wait for error state to render with Retry button
        await waitFor(() => {
          let found = false;
          container.querySelectorAll('button').forEach((btn) => {
            if (btn.textContent === 'Retry') found = true;
          });
          expect(found).toBe(true);
        });

        // Click "Retry"
        let retryBtn: HTMLButtonElement | null = null;
        container.querySelectorAll('button').forEach((btn) => {
          if (btn.textContent === 'Retry') {
            retryBtn = btn as HTMLButtonElement;
          }
        });
        expect(retryBtn).not.toBeNull();
        fireEvent.click(retryBtn!);

        // Wait for the second fetch call
        await waitFor(() => {
          expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        // Capture the second request body
        const secondCallBody = fetchMock.mock.calls[1][1]?.body;

        // Verify both request bodies are byte-identical
        expect(firstCallBody).toBe(secondCallBody);

        // Also verify the content matches what was edited
        const parsedBody = JSON.parse(firstCallBody);
        expect(parsedBody.patientId).toBe('test-patient-uuid');
        expect(parsedBody.sections).toHaveLength(4);

        for (const heading of headings) {
          const section = parsedBody.sections.find(
            (s: { heading: string }) => s.heading === heading
          );
          expect(section.content).toBe(editedContent[heading]);
        }

        unmount();
      }),
      { numRuns: 100 }
    );
  });
});
