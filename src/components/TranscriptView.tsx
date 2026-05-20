'use client';

import { useEffect, useRef } from 'react';
import { TranscriptSegment } from '../types';

export interface TranscriptViewProps {
  segments: TranscriptSegment[];
  highlightedSegmentId?: string | null;
  onSegmentClick?: (segment: TranscriptSegment) => void;
}

/**
 * TranscriptView — Displays real-time transcript with speaker labels, auto-scroll,
 * and color-coded segments for CLINICIAN vs PATIENT.
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */
export function TranscriptView({
  segments,
  highlightedSegmentId,
  onSegmentClick,
}: TranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to keep most recent segment visible
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [segments]);

  if (segments.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-gray-400"
        role="log"
        aria-label="Transcript"
        aria-live="polite"
      >
        <p>No transcript segments yet. Start a session to see the conversation.</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 overflow-y-auto p-4"
      role="log"
      aria-label="Transcript"
      aria-live="polite"
    >
      {segments.map((segment) => (
        <TranscriptSegmentItem
          key={segment.id}
          segment={segment}
          isHighlighted={highlightedSegmentId === segment.id}
          onClick={onSegmentClick}
        />
      ))}
      <div ref={scrollRef} aria-hidden="true" />
    </div>
  );
}

interface TranscriptSegmentItemProps {
  segment: TranscriptSegment;
  isHighlighted: boolean;
  onClick?: (segment: TranscriptSegment) => void;
}

function TranscriptSegmentItem({
  segment,
  isHighlighted,
  onClick,
}: TranscriptSegmentItemProps) {
  const speakerStyles = getSpeakerStyles(segment.speaker);
  const alignment = getAlignment(segment.speaker);

  const highlightClass = isHighlighted
    ? 'ring-2 ring-yellow-400 ring-offset-2'
    : '';

  const partialClass = segment.isPartial ? 'italic opacity-75' : '';

  return (
    <div
      className={`flex ${alignment}`}
      data-testid={`segment-${segment.id}`}
      data-speaker={segment.speaker}
    >
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 ${speakerStyles} ${highlightClass} ${partialClass} ${
          onClick ? 'cursor-pointer' : ''
        }`}
        onClick={() => onClick?.(segment)}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick(segment);
          }
        }}
        aria-label={`${segment.speaker} said: ${segment.content}${segment.isPartial ? ' (in progress)' : ''}`}
      >
        <span className={`text-xs font-semibold uppercase ${getSpeakerLabelColor(segment.speaker)}`}>
          {segment.speaker}
        </span>
        <p className="mt-1 text-sm">{segment.content}</p>
        {segment.isPartial && (
          <span className="mt-1 inline-block text-xs text-gray-500" aria-label="partial transcript">
            ●●●
          </span>
        )}
      </div>
    </div>
  );
}

function getSpeakerStyles(speaker: TranscriptSegment['speaker']): string {
  switch (speaker) {
    case 'CLINICIAN':
      return 'bg-blue-50 border border-blue-200 text-blue-900';
    case 'PATIENT':
      return 'bg-green-50 border border-green-200 text-green-900';
    case 'UNKNOWN':
    default:
      return 'bg-gray-50 border border-gray-200 text-gray-900';
  }
}

function getAlignment(speaker: TranscriptSegment['speaker']): string {
  switch (speaker) {
    case 'CLINICIAN':
      return 'justify-start';
    case 'PATIENT':
      return 'justify-end';
    case 'UNKNOWN':
    default:
      return 'justify-center';
  }
}

function getSpeakerLabelColor(speaker: TranscriptSegment['speaker']): string {
  switch (speaker) {
    case 'CLINICIAN':
      return 'text-blue-600';
    case 'PATIENT':
      return 'text-green-600';
    case 'UNKNOWN':
    default:
      return 'text-gray-600';
  }
}
