/**
 * @jest-environment jsdom
 */

// Feature: clinical-note-writeback, Property 2: Confirmation Dialog Shows Correct Metadata
// **Validates: Requirements 3.1**

import React from 'react';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import { ConfirmationDialog } from './ConfirmationDialog';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/**
 * Generates non-empty patient names (alphanumeric + spaces).
 * Names start and end with alphanumeric characters (no leading/trailing whitespace)
 * and consecutive spaces are collapsed to single spaces since HTML rendering
 * normalizes whitespace in text content.
 */
const patientNameArb = fc
  .tuple(
    fc.stringOf(fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)), { minLength: 1, maxLength: 1 }),
    fc.stringOf(fc.char().filter((c) => /[a-zA-Z0-9 ]/.test(c)), { minLength: 0, maxLength: 48 }),
    fc.stringOf(fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)), { minLength: 1, maxLength: 1 })
  )
  .map(([first, middle, last]) => `${first}${middle}${last}`.replace(/\s+/g, ' '));

/** Generates section counts as integers between 1 and 4. */
const sectionCountArb = fc.integer({ min: 1, max: 4 });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 2: Confirmation Dialog Shows Correct Metadata', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the exact patient name in the dialog', () => {
    fc.assert(
      fc.property(patientNameArb, sectionCountArb, (patientName, sectionCount) => {
        cleanup();

        const { container } = render(
          <ConfirmationDialog
            isOpen={true}
            patientName={patientName}
            sectionCount={sectionCount}
            onConfirm={() => {}}
            onCancel={() => {}}
          />
        );

        const dialog = within(container).getByRole('dialog');
        expect(dialog).toHaveTextContent(patientName);

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('renders the correct section count in the dialog', () => {
    fc.assert(
      fc.property(patientNameArb, sectionCountArb, (patientName, sectionCount) => {
        cleanup();

        const { container } = render(
          <ConfirmationDialog
            isOpen={true}
            patientName={patientName}
            sectionCount={sectionCount}
            onConfirm={() => {}}
            onCancel={() => {}}
          />
        );

        const dialog = within(container).getByRole('dialog');
        expect(dialog).toHaveTextContent(String(sectionCount));

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('displays both patient name and section count simultaneously', () => {
    fc.assert(
      fc.property(patientNameArb, sectionCountArb, (patientName, sectionCount) => {
        cleanup();

        const { container } = render(
          <ConfirmationDialog
            isOpen={true}
            patientName={patientName}
            sectionCount={sectionCount}
            onConfirm={() => {}}
            onCancel={() => {}}
          />
        );

        const dialog = within(container).getByRole('dialog');
        expect(dialog).toHaveTextContent(patientName);
        expect(dialog).toHaveTextContent(String(sectionCount));

        cleanup();
      }),
      { numRuns: 100 }
    );
  });
});
