'use client';

export interface AudioIndicatorProps {
  isActive: boolean;
  source?: 'microphone' | 'wav';
}

/**
 * AudioIndicator — Visual indicator showing audio capture/streaming is active.
 * Displays a pulsing red dot when recording and a gray dot when inactive.
 *
 * @see Requirements 5.5
 */
export function AudioIndicator({ isActive, source = 'microphone' }: AudioIndicatorProps) {
  const label = isActive
    ? source === 'wav'
      ? 'Streaming'
      : 'Recording'
    : 'Not recording';

  const ariaLabel = isActive
    ? `Audio ${label.toLowerCase()} is active`
    : 'Audio is not active';

  return (
    <div
      className="inline-flex items-center gap-2"
      role="status"
      aria-label={ariaLabel}
    >
      <span className="relative flex h-3 w-3">
        {isActive && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-3 w-3 rounded-full ${
            isActive ? 'bg-red-500' : 'bg-gray-400'
          }`}
        />
      </span>
      <span
        className={`text-sm font-medium ${
          isActive ? 'text-red-600' : 'text-gray-500'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
