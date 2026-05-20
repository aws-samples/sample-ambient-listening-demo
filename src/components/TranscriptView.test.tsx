/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TranscriptView } from './TranscriptView';
import { TranscriptSegment } from '../types';

// Mock scrollIntoView since jsdom doesn't support it
const mockScrollIntoView = jest.fn();
window.HTMLElement.prototype.scrollIntoView = mockScrollIntoView;

function createSegment(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    id: 'seg-1',
    content: 'Hello, how are you feeling today?',
    speaker: 'CLINICIAN',
    channelId: 0,
    startTime: 0,
    endTime: 3.5,
    isPartial: false,
    ...overrides,
  };
}

describe('TranscriptView', () => {
  beforeEach(() => {
    mockScrollIntoView.mockClear();
  });

  describe('empty state', () => {
    it('displays empty state message when no segments', () => {
      render(<TranscriptView segments={[]} />);

      expect(screen.getByText(/no transcript segments yet/i)).toBeInTheDocument();
    });

    it('renders with log role for accessibility', () => {
      render(<TranscriptView segments={[]} />);

      expect(screen.getByRole('log', { name: /transcript/i })).toBeInTheDocument();
    });
  });

  describe('segment rendering', () => {
    it('renders transcript segments with content', () => {
      const segments = [createSegment()];
      render(<TranscriptView segments={segments} />);

      expect(screen.getByText('Hello, how are you feeling today?')).toBeInTheDocument();
    });

    it('displays speaker label for each segment', () => {
      const segments = [
        createSegment({ id: 'seg-1', speaker: 'CLINICIAN' }),
        createSegment({ id: 'seg-2', speaker: 'PATIENT', content: 'I feel fine.' }),
      ];
      render(<TranscriptView segments={segments} />);

      expect(screen.getByText('CLINICIAN')).toBeInTheDocument();
      expect(screen.getByText('PATIENT')).toBeInTheDocument();
    });

    it('displays UNKNOWN speaker label for unattributed segments', () => {
      const segments = [createSegment({ speaker: 'UNKNOWN' })];
      render(<TranscriptView segments={segments} />);

      expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
    });

    it('renders multiple segments in order', () => {
      const segments = [
        createSegment({ id: 'seg-1', content: 'First message', startTime: 0 }),
        createSegment({ id: 'seg-2', content: 'Second message', startTime: 4 }),
        createSegment({ id: 'seg-3', content: 'Third message', startTime: 8 }),
      ];
      render(<TranscriptView segments={segments} />);

      const items = screen.getAllByText(/message/);
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent('First message');
      expect(items[1]).toHaveTextContent('Second message');
      expect(items[2]).toHaveTextContent('Third message');
    });
  });

  describe('color coding and visual distinction', () => {
    it('applies blue background styling to CLINICIAN segments', () => {
      const segments = [createSegment({ speaker: 'CLINICIAN' })];
      const { container } = render(<TranscriptView segments={segments} />);

      const segmentEl = container.querySelector('[data-speaker="CLINICIAN"]');
      const bubble = segmentEl?.querySelector('.bg-blue-50');
      expect(bubble).toBeInTheDocument();
    });

    it('applies green background styling to PATIENT segments', () => {
      const segments = [createSegment({ speaker: 'PATIENT' })];
      const { container } = render(<TranscriptView segments={segments} />);

      const segmentEl = container.querySelector('[data-speaker="PATIENT"]');
      const bubble = segmentEl?.querySelector('.bg-green-50');
      expect(bubble).toBeInTheDocument();
    });

    it('applies gray background styling to UNKNOWN segments', () => {
      const segments = [createSegment({ speaker: 'UNKNOWN' })];
      const { container } = render(<TranscriptView segments={segments} />);

      const segmentEl = container.querySelector('[data-speaker="UNKNOWN"]');
      const bubble = segmentEl?.querySelector('.bg-gray-50');
      expect(bubble).toBeInTheDocument();
    });

    it('aligns CLINICIAN segments to the left', () => {
      const segments = [createSegment({ speaker: 'CLINICIAN' })];
      const { container } = render(<TranscriptView segments={segments} />);

      const segmentEl = container.querySelector('[data-speaker="CLINICIAN"]');
      expect(segmentEl).toHaveClass('justify-start');
    });

    it('aligns PATIENT segments to the right', () => {
      const segments = [createSegment({ speaker: 'PATIENT' })];
      const { container } = render(<TranscriptView segments={segments} />);

      const segmentEl = container.querySelector('[data-speaker="PATIENT"]');
      expect(segmentEl).toHaveClass('justify-end');
    });

    it('centers UNKNOWN segments', () => {
      const segments = [createSegment({ speaker: 'UNKNOWN' })];
      const { container } = render(<TranscriptView segments={segments} />);

      const segmentEl = container.querySelector('[data-speaker="UNKNOWN"]');
      expect(segmentEl).toHaveClass('justify-center');
    });
  });

  describe('auto-scroll', () => {
    it('calls scrollIntoView when segments change', () => {
      const segments = [createSegment()];
      render(<TranscriptView segments={segments} />);

      expect(mockScrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      });
    });

    it('calls scrollIntoView again when new segments are added', () => {
      const { rerender } = render(
        <TranscriptView segments={[createSegment({ id: 'seg-1' })]} />
      );

      mockScrollIntoView.mockClear();

      rerender(
        <TranscriptView
          segments={[
            createSegment({ id: 'seg-1' }),
            createSegment({ id: 'seg-2', content: 'New segment' }),
          ]}
        />
      );

      expect(mockScrollIntoView).toHaveBeenCalled();
    });
  });

  describe('segment highlighting', () => {
    it('applies highlight ring to the specified segment', () => {
      const segments = [
        createSegment({ id: 'seg-1' }),
        createSegment({ id: 'seg-2', content: 'Highlighted one' }),
      ];
      const { container } = render(
        <TranscriptView segments={segments} highlightedSegmentId="seg-2" />
      );

      const highlightedEl = container.querySelector('[data-testid="segment-seg-2"]');
      const bubble = highlightedEl?.querySelector('.ring-2');
      expect(bubble).toBeInTheDocument();
    });

    it('does not apply highlight ring to non-highlighted segments', () => {
      const segments = [
        createSegment({ id: 'seg-1' }),
        createSegment({ id: 'seg-2', content: 'Not highlighted' }),
      ];
      const { container } = render(
        <TranscriptView segments={segments} highlightedSegmentId="seg-1" />
      );

      const nonHighlightedEl = container.querySelector('[data-testid="segment-seg-2"]');
      const bubble = nonHighlightedEl?.querySelector('.ring-2');
      expect(bubble).not.toBeInTheDocument();
    });

    it('does not apply highlight when highlightedSegmentId is null', () => {
      const segments = [createSegment({ id: 'seg-1' })];
      const { container } = render(
        <TranscriptView segments={segments} highlightedSegmentId={null} />
      );

      const ring = container.querySelector('.ring-2');
      expect(ring).not.toBeInTheDocument();
    });
  });

  describe('partial segments', () => {
    it('renders partial segments with italic styling', () => {
      const segments = [createSegment({ isPartial: true })];
      const { container } = render(<TranscriptView segments={segments} />);

      const bubble = container.querySelector('.italic');
      expect(bubble).toBeInTheDocument();
    });

    it('renders partial indicator for partial segments', () => {
      const segments = [createSegment({ isPartial: true })];
      render(<TranscriptView segments={segments} />);

      expect(screen.getByLabelText('partial transcript')).toBeInTheDocument();
    });

    it('does not render partial indicator for complete segments', () => {
      const segments = [createSegment({ isPartial: false })];
      render(<TranscriptView segments={segments} />);

      expect(screen.queryByLabelText('partial transcript')).not.toBeInTheDocument();
    });
  });

  describe('segment click interaction', () => {
    it('calls onSegmentClick when a segment is clicked', () => {
      const handleClick = jest.fn();
      const segment = createSegment();
      render(<TranscriptView segments={[segment]} onSegmentClick={handleClick} />);

      fireEvent.click(screen.getByText(segment.content));
      expect(handleClick).toHaveBeenCalledWith(segment);
    });

    it('calls onSegmentClick on Enter key press', () => {
      const handleClick = jest.fn();
      const segment = createSegment();
      render(<TranscriptView segments={[segment]} onSegmentClick={handleClick} />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Enter' });
      expect(handleClick).toHaveBeenCalledWith(segment);
    });

    it('calls onSegmentClick on Space key press', () => {
      const handleClick = jest.fn();
      const segment = createSegment();
      render(<TranscriptView segments={[segment]} onSegmentClick={handleClick} />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: ' ' });
      expect(handleClick).toHaveBeenCalledWith(segment);
    });

    it('does not render button role when onSegmentClick is not provided', () => {
      const segments = [createSegment()];
      render(<TranscriptView segments={segments} />);

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
