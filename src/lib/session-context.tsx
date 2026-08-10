'use client';

import React, { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';
import type { AmbientSession, TranscriptSegment, ClinicalNote } from '@/types';

// ─── State ───────────────────────────────────────────────────────────────────

export interface SessionState {
  session: AmbientSession | null;
  transcriptSegments: TranscriptSegment[];
  clinicalNote: ClinicalNote | null;
  afterVisitSummary: string | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: SessionState = {
  session: null,
  transcriptSegments: [],
  clinicalNote: null,
  afterVisitSummary: null,
  isLoading: false,
  error: null,
};

// ─── Actions ─────────────────────────────────────────────────────────────────

type SessionAction =
  | { type: 'START_SESSION_REQUEST' }
  | { type: 'START_SESSION_SUCCESS'; payload: AmbientSession }
  | { type: 'START_SESSION_FAILURE'; payload: string }
  | { type: 'END_SESSION_REQUEST' }
  | { type: 'END_SESSION_SUCCESS'; payload: AmbientSession }
  | { type: 'END_SESSION_FAILURE'; payload: string }
  | { type: 'ADD_TRANSCRIPT'; payload: TranscriptSegment }
  | { type: 'SET_OUTPUTS'; payload: { clinicalNote: ClinicalNote; afterVisitSummary: string } }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'UPDATE_SESSION_STATUS'; payload: AmbientSession['status'] }
  | { type: 'RESET' };

// ─── Reducer ─────────────────────────────────────────────────────────────────

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'START_SESSION_REQUEST':
      return { ...state, isLoading: true, error: null };

    case 'START_SESSION_SUCCESS':
      return { ...state, isLoading: false, session: action.payload, error: null };

    case 'START_SESSION_FAILURE':
      return { ...state, isLoading: false, error: action.payload };

    case 'END_SESSION_REQUEST':
      return {
        ...state,
        isLoading: true,
        session: state.session
          ? { ...state.session, status: 'ending' }
          : null,
      };

    case 'END_SESSION_SUCCESS':
      return { ...state, isLoading: false, session: action.payload };

    case 'END_SESSION_FAILURE':
      return { ...state, isLoading: false, error: action.payload };

    case 'ADD_TRANSCRIPT':
      return {
        ...state,
        transcriptSegments: [...state.transcriptSegments, action.payload],
      };

    case 'SET_OUTPUTS':
      return {
        ...state,
        clinicalNote: action.payload.clinicalNote,
        afterVisitSummary: action.payload.afterVisitSummary,
      };

    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'UPDATE_SESSION_STATUS':
      return {
        ...state,
        session: state.session
          ? { ...state.session, status: action.payload }
          : null,
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface SessionContextValue {
  state: SessionState;
  startSession: (patientId: string, patientContext: string) => Promise<void>;
  endSession: () => Promise<void>;
  addTranscript: (segment: TranscriptSegment) => void;
  setOutputs: (clinicalNote: ClinicalNote, afterVisitSummary: string) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  const startSession = useCallback(async (patientId: string, patientContext: string) => {
    dispatch({ type: 'START_SESSION_REQUEST' });

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, patientContext }),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to create session' }));
        throw new Error(errorData.message || `Session creation failed with status ${response.status}`);
      }

      const session: AmbientSession = await response.json();
      dispatch({ type: 'START_SESSION_SUCCESS', payload: session });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      dispatch({ type: 'START_SESSION_FAILURE', payload: message });
    }
  }, []);

  const endSession = useCallback(async () => {
    if (!state.session) {
      dispatch({ type: 'END_SESSION_FAILURE', payload: 'No active session to end' });
      return;
    }

    dispatch({ type: 'END_SESSION_REQUEST' });

    try {
      const response = await fetch(`/api/sessions/${state.session.sessionId}/end`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to end session' }));
        throw new Error(errorData.message || `Session end failed with status ${response.status}`);
      }

      const endData = await response.json();
      const endedSession: AmbientSession = {
        ...state.session,
        status: 'ended',
        endedAt: endData.endedAt ? new Date(endData.endedAt) : new Date(),
      };
      dispatch({ type: 'END_SESSION_SUCCESS', payload: endedSession });

      // After session ends, poll for outputs
      console.log('[Session] Polling for outputs');
      pollForOutputs(state.session.sessionId, state.session.domainId, state.session.subscriptionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      dispatch({ type: 'END_SESSION_FAILURE', payload: message });
    }
  }, [state.session]);

  /**
   * Polls the outputs API for clinical note and after-visit summary.
   * Retries up to 6 times with 10-second intervals (60 seconds total).
   */
  const pollForOutputs = useCallback(async (sessionId: string, domainId: string, subscriptionId: string) => {
    const MAX_ATTEMPTS = 6;
    const POLL_INTERVAL = 10000; // 10 seconds
    console.log('[Session] Starting output poll for:', sessionId);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        console.log(`[Session] Poll attempt ${attempt + 1}/${MAX_ATTEMPTS}`);
        const response = await fetch(`/api/sessions/${sessionId}/outputs?domainId=${domainId}&subscriptionId=${subscriptionId}`, {
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[Session] Poll response received:', { hasClinicalNote: !!data.clinicalNote, hasAfterVisitSummary: !!data.afterVisitSummary });
          if (data.clinicalNote || data.afterVisitSummary) {
            dispatch({
              type: 'SET_OUTPUTS',
              payload: {
                clinicalNote: data.clinicalNote || { sections: [], evidenceMap: [] },
                afterVisitSummary: data.afterVisitSummary || '',
              },
            });
            return; // Success — stop polling
          }
        }
      } catch {
        // Ignore errors during polling, will retry
      }

      // Wait before next attempt
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }
    }
  }, []);

  const addTranscript = useCallback((segment: TranscriptSegment) => {
    dispatch({ type: 'ADD_TRANSCRIPT', payload: segment });
  }, []);

  const setOutputs = useCallback((clinicalNote: ClinicalNote, afterVisitSummary: string) => {
    dispatch({ type: 'SET_OUTPUTS', payload: { clinicalNote, afterVisitSummary } });
  }, []);

  const setError = useCallback((error: string) => {
    dispatch({ type: 'SET_ERROR', payload: error });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const value: SessionContextValue = {
    state,
    startSession,
    endSession,
    addTranscript,
    setOutputs,
    setError,
    reset,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook to access session state and actions.
 * Must be used within a SessionProvider.
 *
 * @throws Error if used outside of SessionProvider
 */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
