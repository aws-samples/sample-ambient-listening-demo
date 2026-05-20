'use client';

import { useState, useRef, useCallback } from 'react';
import { useSession } from '@/lib/session-context';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AudioSource = 'microphone' | 'wav';

export interface SessionControlsProps {
  patientId: string | null;
  patientContext: string | null;
  onAudioSourceChange?: (source: AudioSource, file?: File) => void;
}

// ─── Lifecycle Stages ────────────────────────────────────────────────────────

const LIFECYCLE_STAGES = [
  { key: 'creating_domain', label: 'Domain Setup' },
  { key: 'creating_subscription', label: 'Subscription' },
  { key: 'creating_session', label: 'Session Creation' },
  { key: 'active', label: 'Active' },
  { key: 'ending', label: 'Ending' },
  { key: 'ended', label: 'Ended' },
] as const;

type LifecycleStageKey = (typeof LIFECYCLE_STAGES)[number]['key'];

// ─── SessionLifecycleIndicator ───────────────────────────────────────────────

export interface SessionLifecycleIndicatorProps {
  currentStage: LifecycleStageKey | 'error' | null;
}

/**
 * SessionLifecycleIndicator — Displays the session lifecycle as a horizontal stepper.
 * Shows completed, current, and upcoming stages with visual distinction.
 *
 * @see Requirements 4.6
 */
export function SessionLifecycleIndicator({ currentStage }: SessionLifecycleIndicatorProps) {
  if (!currentStage) return null;

  const currentIndex = LIFECYCLE_STAGES.findIndex((s) => s.key === currentStage);
  const isError = currentStage === 'error';

  return (
    <div className="w-full" role="group" aria-label="Session lifecycle stages">
      <div className="flex items-center justify-between">
        {LIFECYCLE_STAGES.map((stage, index) => {
          const isCompleted = !isError && currentIndex > index;
          const isCurrent = !isError && currentIndex === index;

          let stepClass = 'bg-gray-200 text-gray-500'; // upcoming
          let labelClass = 'text-gray-400';

          if (isCompleted) {
            stepClass = 'bg-green-500 text-white';
            labelClass = 'text-green-700';
          } else if (isCurrent) {
            stepClass = 'bg-blue-500 text-white ring-2 ring-blue-300';
            labelClass = 'text-blue-700 font-medium';
          } else if (isError) {
            stepClass = 'bg-red-500 text-white';
            labelClass = 'text-red-700';
          }

          // Connector line between steps
          const connectorClass = isCompleted
            ? 'bg-green-500'
            : 'bg-gray-200';

          return (
            <div key={stage.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${stepClass}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`${stage.label}${isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}`}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <span className={`mt-1 text-xs text-center whitespace-nowrap ${labelClass}`}>
                  {stage.label}
                </span>
              </div>
              {index < LIFECYCLE_STAGES.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 mt-[-1rem] ${connectorClass}`} aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      {isError && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-600" role="status">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>Session encountered an error</span>
        </div>
      )}
    </div>
  );
}

// ─── SessionControls ─────────────────────────────────────────────────────────

/**
 * SessionControls — Start/end session buttons, audio source selection, and lifecycle display.
 * Integrates with the session context to manage ambient documentation sessions.
 *
 * @see Requirements 4.4, 4.6, 5.3, 5.4
 */
export function SessionControls({ patientId, patientContext, onAudioSourceChange }: SessionControlsProps) {
  const { state, startSession, endSession } = useSession();
  const [audioSource, setAudioSource] = useState<AudioSource>('microphone');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const session = state.session;
  const isSessionActive = session?.status === 'active';
  const isSessionInProgress =
    session?.status === 'creating_domain' ||
    session?.status === 'creating_subscription' ||
    session?.status === 'creating_session';
  const isSessionEnding = session?.status === 'ending';
  const isSessionEnded = session?.status === 'ended';
  const canStartSession = !!patientId && !!patientContext && !session && !state.isLoading;
  const canEndSession = isSessionActive && !state.isLoading;

  const handleStartSession = useCallback(async () => {
    if (!patientId || !patientContext) return;
    await startSession(patientId, patientContext);
  }, [patientId, patientContext, startSession]);

  const handleEndSession = useCallback(async () => {
    await endSession();
  }, [endSession]);

  const handleAudioSourceChange = useCallback(
    (source: AudioSource) => {
      setAudioSource(source);
      if (source === 'microphone') {
        setSelectedFile(null);
        onAudioSourceChange?.('microphone');
      } else {
        onAudioSourceChange?.('wav', selectedFile ?? undefined);
      }
    },
    [onAudioSourceChange, selectedFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setSelectedFile(file);
      if (file) {
        onAudioSourceChange?.('wav', file);
      }
    },
    [onAudioSourceChange],
  );

  return (
    <div className="flex flex-col gap-4 p-4 border border-gray-200 rounded-lg bg-white">
      {/* Audio Source Selection */}
      <fieldset className="flex flex-col gap-2" disabled={isSessionActive || isSessionInProgress || isSessionEnding}>
        <legend className="text-sm font-medium text-gray-700 mb-1">Audio Source</legend>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="audio-source"
              value="microphone"
              checked={audioSource === 'microphone'}
              onChange={() => handleAudioSourceChange('microphone')}
              className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Microphone</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="audio-source"
              value="wav"
              checked={audioSource === 'wav'}
              onChange={() => handleAudioSourceChange('wav')}
              className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">WAV File</span>
          </label>
        </div>

        {audioSource === 'wav' && (
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 transition-colors"
            >
              Choose File
            </button>
            <span className="text-sm text-gray-500 truncate max-w-[200px]">
              {selectedFile ? selectedFile.name : 'No file selected'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,audio/wav"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Select WAV audio file"
            />
          </div>
        )}
      </fieldset>

      {/* Session Action Buttons */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleStartSession}
          disabled={!canStartSession}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          aria-label="Start session"
        >
          {state.isLoading && !session ? 'Starting…' : 'Start Session'}
        </button>

        <button
          type="button"
          onClick={handleEndSession}
          disabled={!canEndSession}
          className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          aria-label="End session"
        >
          {isSessionEnding ? 'Ending…' : 'End Session'}
        </button>

        {(isSessionInProgress || isSessionActive) && (
          <span className="flex items-center gap-1.5 text-xs text-green-600">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            {isSessionActive ? 'Session active' : 'Setting up…'}
          </span>
        )}

        {isSessionEnded && (
          <span className="text-xs text-gray-500">Session ended</span>
        )}
      </div>

      {/* Lifecycle Indicator */}
      {session && (
        <SessionLifecycleIndicator currentStage={session.status} />
      )}

      {/* Error Display */}
      {state.error && (
        <div className="p-3 border border-red-200 bg-red-50 rounded-lg" role="alert">
          <p className="text-sm font-medium text-red-800">Session Error</p>
          <p className="mt-1 text-sm text-red-600">{state.error}</p>
          {session?.error?.suggestedAction && (
            <p className="mt-1 text-xs text-red-500">
              Suggestion: {session.error.suggestedAction}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
