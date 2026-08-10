'use client';

import { useEffect } from 'react';
import { useWriteBack } from '@/lib/use-writeback';

export interface WriteBackConfirmationProps {
  status: 'idle' | 'saving' | 'success' | 'error';
  error?: string | null;
  retryCount?: number;
  maxRetries?: number;
  onRetry?: () => void;
}

/**
 * WriteBackConfirmation — Displays confirmation or error state when writing
 * a clinical note back to OpenEMR via the FHIR API.
 *
 * Shows a success banner (green with checkmark) on successful save,
 * or an error message with a retry button (up to maxRetries attempts) on failure.
 *
 * @see Requirements 14.3, 14.4
 */
export function WriteBackConfirmation({
  status,
  error = null,
  retryCount = 0,
  maxRetries = 3,
  onRetry,
}: WriteBackConfirmationProps) {
  if (status === 'idle') {
    return null;
  }

  if (status === 'saving') {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700"
        role="status"
        aria-label="Saving clinical note to OpenEMR"
      >
        <svg
          className="h-5 w-5 animate-spin text-blue-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span>Saving clinical note to OpenEMR…</span>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        role="status"
        aria-label="Clinical note saved successfully"
      >
        <svg
          className="h-5 w-5 text-green-500"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <span>Clinical note saved to patient chart successfully.</span>
      </div>
    );
  }

  // status === 'error'
  const retriesExhausted = retryCount >= maxRetries;

  return (
    <div
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      role="alert"
      aria-label="Failed to save clinical note"
    >
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 text-red-500"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
        <span>
          {error || 'Failed to save clinical note to OpenEMR.'}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={retriesExhausted}
          className={`rounded px-3 py-1 text-sm font-medium ${
            retriesExhausted
              ? 'cursor-not-allowed bg-gray-200 text-gray-400'
              : 'bg-red-600 text-white hover:bg-red-700'
          }`}
          aria-label={retriesExhausted ? 'Retry limit reached' : 'Retry saving clinical note'}
        >
          Retry
        </button>
        <span className="text-xs text-red-500">
          {retriesExhausted
            ? `Maximum retries reached (${maxRetries}/${maxRetries})`
            : `Attempt ${retryCount} of ${maxRetries}`}
        </span>
      </div>
    </div>
  );
}

// ─── Integrated Component ────────────────────────────────────────────────────

export interface WriteBackConfirmationConnectedProps {
  /** Session ID for the writeback API call */
  sessionId: string;
  /** Patient ID for the FHIR DocumentReference */
  patientId: string;
  /** Clinical note content to write back */
  clinicalNote: string;
  /** Session date in ISO 8601 format */
  sessionDate: string;
  /** Whether to automatically trigger write-back on mount */
  autoTrigger?: boolean;
  /** Callback when write-back succeeds */
  onSuccess?: (documentId: string | null) => void;
  /** Callback when write-back fails permanently (max retries exhausted) */
  onPermanentFailure?: (error: string) => void;
}

/**
 * WriteBackConfirmationConnected — Self-contained component that calls the
 * /api/sessions/[id]/writeback endpoint and displays the result.
 *
 * Automatically triggers the write-back on mount when autoTrigger is true (default).
 * Manages retry state internally (up to 3 attempts).
 *
 * @see Requirements 14.3, 14.4
 */
export function WriteBackConfirmationConnected({
  sessionId,
  patientId,
  clinicalNote,
  sessionDate,
  autoTrigger = true,
  onSuccess,
  onPermanentFailure,
}: WriteBackConfirmationConnectedProps) {
  const { state, writeBack, retry } = useWriteBack({ maxRetries: 3 });

  useEffect(() => {
    if (autoTrigger && state.status === 'idle') {
      writeBack({ sessionId, patientId, clinicalNote, sessionDate });
    }
  }, [autoTrigger, state.status, writeBack, sessionId, patientId, clinicalNote, sessionDate]);

  useEffect(() => {
    if (state.status === 'success' && onSuccess) {
      onSuccess(state.documentId);
    }
  }, [state.status, state.documentId, onSuccess]);

  useEffect(() => {
    if (state.status === 'error' && state.retryCount >= state.maxRetries && onPermanentFailure) {
      onPermanentFailure(state.error ?? 'Unknown error');
    }
  }, [state.status, state.retryCount, state.maxRetries, state.error, onPermanentFailure]);

  return (
    <WriteBackConfirmation
      status={state.status}
      error={state.error}
      retryCount={state.retryCount}
      maxRetries={state.maxRetries}
      onRetry={retry}
    />
  );
}
