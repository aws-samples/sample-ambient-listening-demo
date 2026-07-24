'use client';

import { useState, useCallback } from 'react';

export interface WriteBackState {
  status: 'idle' | 'saving' | 'success' | 'error';
  error: string | null;
  retryCount: number;
  maxRetries: number;
  documentId: string | null;
}

export interface UseWriteBackOptions {
  maxRetries?: number;
}

export interface UseWriteBackReturn {
  state: WriteBackState;
  writeBack: (params: WriteBackParams) => Promise<void>;
  retry: () => void;
  reset: () => void;
}

export interface WriteBackParams {
  sessionId: string;
  patientId: string;
  clinicalNote: string;
  sessionDate: string;
}

/**
 * useWriteBack — Custom hook that manages the write-back of a clinical note
 * to OpenEMR via the /api/sessions/[id]/writeback endpoint.
 *
 * IMPORTANT: This hook should only be invoked after the clinician has reviewed
 * and approved the AI-generated clinical note. AI outputs are assistive and
 * must not be written to the EHR without human validation.
 *
 * Handles:
 * - Calling the writeback API endpoint
 * - Tracking saving/success/error status
 * - Retry logic with a configurable maximum (default 3)
 * - Storing the last request params for retry
 *
 * @see Requirements 14.3, 14.4
 */
export function useWriteBack(options: UseWriteBackOptions = {}): UseWriteBackReturn {
  const maxRetries = options.maxRetries ?? 3;

  const [state, setState] = useState<WriteBackState>({
    status: 'idle',
    error: null,
    retryCount: 0,
    maxRetries,
    documentId: null,
  });

  const [lastParams, setLastParams] = useState<WriteBackParams | null>(null);

  const performWriteBack = useCallback(async (params: WriteBackParams, currentRetryCount: number) => {
    setState(prev => ({
      ...prev,
      status: 'saving',
      error: null,
    }));

    try {
      const response = await fetch(`/api/sessions/${params.sessionId}/writeback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: params.patientId,
          clinicalNote: params.clinicalNote,
          sessionDate: params.sessionDate,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          message: `Write-back failed with status ${response.status}`,
        })) as { message?: string };

        throw new Error(errorData.message || `Write-back failed with status ${response.status}`);
      }

      const result = await response.json() as { success: boolean; documentId?: string };

      setState(prev => ({
        ...prev,
        status: 'success',
        error: null,
        documentId: result.documentId ?? null,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setState(prev => ({
        ...prev,
        status: 'error',
        error: message,
        retryCount: currentRetryCount,
      }));
    }
  }, []);

  const writeBack = useCallback(async (params: WriteBackParams) => {
    setLastParams(params);
    await performWriteBack(params, 0);
  }, [performWriteBack]);

  const retry = useCallback(() => {
    if (!lastParams) return;
    if (state.retryCount >= maxRetries) return;

    const nextRetryCount = state.retryCount + 1;
    setState(prev => ({ ...prev, retryCount: nextRetryCount }));
    performWriteBack(lastParams, nextRetryCount);
  }, [lastParams, state.retryCount, maxRetries, performWriteBack]);

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      error: null,
      retryCount: 0,
      maxRetries,
      documentId: null,
    });
    setLastParams(null);
  }, [maxRetries]);

  return { state, writeBack, retry, reset };
}
