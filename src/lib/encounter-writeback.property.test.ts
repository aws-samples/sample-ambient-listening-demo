// Feature: clinical-note-writeback, Property 7: SOAP Formatting Preserves All Content
// **Validates: Requirements 7.4**

import * as fc from 'fast-check';
import { formatSOAPContent, SOAPSection } from './encounter-writeback';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generates non-empty heading strings (unicode, special chars). */
const headingArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 100 }),
  fc.unicodeString({ minLength: 1, maxLength: 80 })
);

/** Generates content strings including multi-line, unicode, and special characters. */
const contentArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 500 }),
  fc.unicodeString({ minLength: 0, maxLength: 300 }),
  fc.array(fc.string({ minLength: 0, maxLength: 80 }), { minLength: 1, maxLength: 10 }).map(
    (lines) => lines.join('\n')
  )
);

/** Generates a single SOAPSection with arbitrary heading and content. */
const soapSectionArb: fc.Arbitrary<SOAPSection> = fc.record({
  heading: headingArb,
  content: contentArb,
});

/** Generates a non-empty array of SOAPSections (1 to 6 sections). */
const soapSectionsArb = fc.array(soapSectionArb, { minLength: 1, maxLength: 6 });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 7: SOAP Formatting Preserves All Content', () => {
  it('formatted output contains every section heading', () => {
    fc.assert(
      fc.property(soapSectionsArb, (sections) => {
        const formatted = formatSOAPContent(sections);

        for (const section of sections) {
          expect(formatted).toContain(`${section.heading}:`);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('formatted output contains every character of every section content', () => {
    fc.assert(
      fc.property(soapSectionsArb, (sections) => {
        const formatted = formatSOAPContent(sections);

        for (const section of sections) {
          expect(formatted).toContain(section.content);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('formatted output preserves content exactly without modification or truncation', () => {
    fc.assert(
      fc.property(soapSectionsArb, (sections) => {
        const formatted = formatSOAPContent(sections);

        // Each section should appear as "heading:\ncontent"
        for (const section of sections) {
          const expectedBlock = `${section.heading}:\n${section.content}`;
          expect(formatted).toContain(expectedBlock);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('formatted output for single section has no trailing double newline', () => {
    fc.assert(
      fc.property(soapSectionArb, (section) => {
        const formatted = formatSOAPContent([section]);

        expect(formatted).toBe(`${section.heading}:\n${section.content}`);
      }),
      { numRuns: 100 }
    );
  });

  it('sections are separated by exactly one double newline', () => {
    fc.assert(
      fc.property(
        fc.array(soapSectionArb, { minLength: 2, maxLength: 6 }),
        (sections) => {
          const formatted = formatSOAPContent(sections);

          // Verify the overall structure: sections joined by \n\n
          const expectedParts = sections.map((s) => `${s.heading}:\n${s.content}`);
          const expected = expectedParts.join('\n\n');
          expect(formatted).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});
