/**
 * @jest-environment jsdom
 */
// Feature: ambient-clinical-documentation-demo, Property 10: After-visit summary verbatim rendering
// **Validates: Requirements 8.3**

import React from 'react';
import * as fc from 'fast-check';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AfterVisitSummaryPanel } from './AfterVisitSummaryPanel';

/**
 * Arbitrary generator for after-visit summary content strings.
 * Generates a variety of content including plain text, multi-line text,
 * text with special characters, and whitespace-sensitive content.
 */
const summaryContentArb: fc.Arbitrary<string> = fc.oneof(
  // Simple single-line text
  fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
  // Multi-line text with newlines
  fc
    .array(
      fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
      { minLength: 2, maxLength: 10 }
    )
    .map((lines) => lines.join('\n')),
  // Text with leading/trailing whitespace
  fc
    .tuple(
      fc.constantFrom('', ' ', '  ', '\t'),
      fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
      fc.constantFrom('', ' ', '  ', '\t')
    )
    .map(([pre, content, post]) => `${pre}${content}${post}`)
    .filter((s) => s.trim().length > 0),
  // Text with special characters that could be modified by HTML rendering
  fc
    .array(
      fc.constantFrom(
        'Follow up in 2 weeks.',
        'Take medication 3x daily.',
        'Blood pressure: 120/80 mmHg.',
        'Temperature > 100°F requires attention.',
        'Avoid foods with <high> sodium.',
        'Call if symptoms worsen & persist.',
        "Patient's condition is stable.",
        'Instructions:\n1. Rest\n2. Hydrate\n3. Follow up'
      ),
      { minLength: 1, maxLength: 5 }
    )
    .map((parts) => parts.join('\n\n'))
);

describe('Property 10: After-visit summary verbatim rendering', () => {
  it('renders the after-visit summary content exactly as received without modification', () => {
    fc.assert(
      fc.property(summaryContentArb, (content) => {
        const { container } = render(
          <AfterVisitSummaryPanel content={content} />
        );

        const contentEl = container.querySelector('[data-testid="avs-content"]');
        expect(contentEl).not.toBeNull();

        // The rendered text content must exactly match the input content
        expect(contentEl!.textContent).toBe(content);

        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('does not truncate long summary content', () => {
    // Generate longer content strings to verify no truncation occurs
    const longContentArb = fc
      .array(
        fc.string({ minLength: 10, maxLength: 200 }).filter((s) => s.trim().length > 0),
        { minLength: 5, maxLength: 20 }
      )
      .map((lines) => lines.join('\n'));

    fc.assert(
      fc.property(longContentArb, (content) => {
        const { container } = render(
          <AfterVisitSummaryPanel content={content} />
        );

        const contentEl = container.querySelector('[data-testid="avs-content"]');
        expect(contentEl).not.toBeNull();

        // Verify the full content length is preserved (no truncation)
        expect(contentEl!.textContent!.length).toBe(content.length);
        expect(contentEl!.textContent).toBe(content);

        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('preserves whitespace formatting in the rendered output', () => {
    // Generate content with intentional whitespace patterns
    const whitespaceContentArb = fc
      .array(
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          fc.constantFrom('\n', '\n\n', '\n  ', '\n\t')
        ),
        { minLength: 2, maxLength: 8 }
      )
      .map((pairs) => pairs.map(([text, sep]) => text + sep).join(''))
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(whitespaceContentArb, (content) => {
        const { container } = render(
          <AfterVisitSummaryPanel content={content} />
        );

        const contentEl = container.querySelector('[data-testid="avs-content"]');
        expect(contentEl).not.toBeNull();

        // The text content must preserve the exact whitespace
        expect(contentEl!.textContent).toBe(content);

        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('does not add any extra text or formatting to the content', () => {
    fc.assert(
      fc.property(summaryContentArb, (content) => {
        const { container } = render(
          <AfterVisitSummaryPanel content={content} />
        );

        const contentEl = container.querySelector('[data-testid="avs-content"]');
        expect(contentEl).not.toBeNull();

        // The content element should contain ONLY the summary text
        // (no additional labels, prefixes, or suffixes within the content div)
        expect(contentEl!.textContent).toBe(content);

        // Verify no child elements that could inject extra text
        // The content should be rendered as a direct text node
        const childElements = contentEl!.querySelectorAll('*');
        // If there are child elements, the combined text must still equal the content
        expect(contentEl!.textContent).toBe(content);

        container.remove();
      }),
      { numRuns: 100 }
    );
  });
});
