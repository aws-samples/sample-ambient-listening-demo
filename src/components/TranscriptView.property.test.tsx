/**
 * @jest-environment jsdom
 */
// Feature: ambient-clinical-documentation-demo, Property 8: Transcript speaker attribution and visual distinction
// **Validates: Requirements 6.2, 6.3**

import React from 'react';
import * as fc from 'fast-check';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TranscriptView } from './TranscriptView';
import { TranscriptSegment } from '../types';

// Mock scrollIntoView since jsdom doesn't support it
window.HTMLElement.prototype.scrollIntoView = jest.fn();

/**
 * Arbitrary generator for TranscriptSegment with CLINICIAN or PATIENT speaker roles.
 */
const transcriptSegmentArb = (index: number): fc.Arbitrary<TranscriptSegment> =>
  fc.record({
    id: fc.constant(`seg-${index}`),
    content: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
    speaker: fc.constantFrom('CLINICIAN' as const, 'PATIENT' as const),
    channelId: fc.constantFrom(0, 1),
    startTime: fc.float({ min: 0, max: 3600, noNaN: true }),
    endTime: fc.float({ min: 0, max: 3600, noNaN: true }),
    isPartial: fc.boolean(),
  });

/**
 * Generate an array of 1-5 transcript segments with unique IDs.
 */
const segmentsArb: fc.Arbitrary<TranscriptSegment[]> = fc
  .integer({ min: 1, max: 5 })
  .chain((len) =>
    fc.tuple(...Array.from({ length: len }, (_, i) => transcriptSegmentArb(i)))
  )
  .map((tuple) => tuple as TranscriptSegment[]);

describe('Property 8: Transcript speaker attribution and visual distinction', () => {
  it('each segment displays the correct speaker label and visually distinct styling', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const { container } = render(<TranscriptView segments={segments} />);

        for (const segment of segments) {
          const segmentEl = container.querySelector(
            `[data-speaker="${segment.speaker}"]`
          );

          // The segment element with the correct data-speaker attribute must exist
          expect(segmentEl).not.toBeNull();

          // The speaker label text must be present in the segment
          expect(segmentEl!.textContent).toContain(segment.speaker);
        }

        // Cleanup for next iteration
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('CLINICIAN segments have blue styling and justify-start alignment', () => {
    fc.assert(
      fc.property(transcriptSegmentArb(0), (segment) => {
        // Force CLINICIAN speaker
        const clinicianSegment: TranscriptSegment = { ...segment, speaker: 'CLINICIAN' };
        const { container } = render(
          <TranscriptView segments={[clinicianSegment]} />
        );

        const segmentEl = container.querySelector('[data-speaker="CLINICIAN"]');
        expect(segmentEl).not.toBeNull();

        // Verify data-speaker attribute
        expect(segmentEl!.getAttribute('data-speaker')).toBe('CLINICIAN');

        // Verify blue styling (bg-blue-50 class on inner bubble)
        const bubble = segmentEl!.querySelector('.bg-blue-50');
        expect(bubble).not.toBeNull();

        // Verify justify-start alignment on the container
        expect(segmentEl!.className).toContain('justify-start');

        // Verify speaker label text is present
        expect(segmentEl!.textContent).toContain('CLINICIAN');

        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('PATIENT segments have green styling and justify-end alignment', () => {
    fc.assert(
      fc.property(transcriptSegmentArb(0), (segment) => {
        // Force PATIENT speaker
        const patientSegment: TranscriptSegment = { ...segment, speaker: 'PATIENT' };
        const { container } = render(
          <TranscriptView segments={[patientSegment]} />
        );

        const segmentEl = container.querySelector('[data-speaker="PATIENT"]');
        expect(segmentEl).not.toBeNull();

        // Verify data-speaker attribute
        expect(segmentEl!.getAttribute('data-speaker')).toBe('PATIENT');

        // Verify green styling (bg-green-50 class on inner bubble)
        const bubble = segmentEl!.querySelector('.bg-green-50');
        expect(bubble).not.toBeNull();

        // Verify justify-end alignment on the container
        expect(segmentEl!.className).toContain('justify-end');

        // Verify speaker label text is present
        expect(segmentEl!.textContent).toContain('PATIENT');

        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('CLINICIAN and PATIENT segments always have different visual styles', () => {
    fc.assert(
      fc.property(
        transcriptSegmentArb(0),
        transcriptSegmentArb(1),
        (seg1, seg2) => {
          const clinicianSeg: TranscriptSegment = { ...seg1, id: 'seg-c', speaker: 'CLINICIAN' };
          const patientSeg: TranscriptSegment = { ...seg2, id: 'seg-p', speaker: 'PATIENT' };

          const { container } = render(
            <TranscriptView segments={[clinicianSeg, patientSeg]} />
          );

          const clinicianEl = container.querySelector('[data-speaker="CLINICIAN"]');
          const patientEl = container.querySelector('[data-speaker="PATIENT"]');

          expect(clinicianEl).not.toBeNull();
          expect(patientEl).not.toBeNull();

          // CLINICIAN has blue styling, PATIENT has green — they must differ
          const clinicianBubble = clinicianEl!.querySelector('.bg-blue-50');
          const patientBubble = patientEl!.querySelector('.bg-green-50');

          expect(clinicianBubble).not.toBeNull();
          expect(patientBubble).not.toBeNull();

          // Verify they have different background classes (visual distinction)
          expect(clinicianBubble!.className).not.toBe(patientBubble!.className);

          // Verify different alignment (additional visual distinction)
          expect(clinicianEl!.className).toContain('justify-start');
          expect(patientEl!.className).toContain('justify-end');

          container.remove();
        }
      ),
      { numRuns: 100 }
    );
  });
});
