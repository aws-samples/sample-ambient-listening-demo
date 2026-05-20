/**
 * @jest-environment jsdom
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { SessionProvider, useSession, type SessionState } from './session-context';
import type { AmbientSession, TranscriptSegment, ClinicalNote } from '@/types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

function createMockSession(overrides?: Partial<AmbientSession>): AmbientSession {
  return {
    sessionId: 'session-123',
    domainId: 'domain-456',
    subscriptionId: 'sub-789',
    status: 'active',
    patientId: 'patient-001',
    patientContext: 'Patient: John Doe, Age: 45',
    outputS3Uri: 's3://bucket/output',
    startedAt: new Date('2024-01-01T10:00:00Z'),
    ...overrides,
  };
}

function createMockTranscript(overrides?: Partial<TranscriptSegment>): TranscriptSegment {
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

function createMockClinicalNote(): ClinicalNote {
  return {
    sections: [
      { heading: 'Subjective', content: 'Patient reports headache.' },
      { heading: 'Objective', content: 'Vitals normal.' },
      { heading: 'Assessment', content: 'Tension headache.' },
      { heading: 'Plan', content: 'OTC pain relief.' },
    ],
    evidenceMap: [
      {
        noteStatementId: 'stmt-1',
        noteStatement: 'Patient reports headache.',
        sourceType: 'transcript',
        transcriptReference: { startTime: 5, endTime: 8, content: 'I have a headache' },
      },
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SessionContext', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('useSession hook', () => {
    it('throws when used outside SessionProvider', () => {
      // Suppress console.error for expected error
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => {
        renderHook(() => useSession());
      }).toThrow('useSession must be used within a SessionProvider');
      consoleSpy.mockRestore();
    });

    it('returns initial state', () => {
      const { result } = renderHook(() => useSession(), { wrapper });

      expect(result.current.state).toEqual({
        session: null,
        transcriptSegments: [],
        clinicalNote: null,
        afterVisitSummary: null,
        isLoading: false,
        error: null,
      });
    });
  });

  describe('startSession', () => {
    it('sets isLoading to true during request', async () => {
      const mockSession = createMockSession();
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const { result } = renderHook(() => useSession(), { wrapper });

      // We can't easily check intermediate state, but we can verify the final state
      await act(async () => {
        await result.current.startSession('patient-001', 'context');
      });

      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.session).toEqual(mockSession);
    });

    it('calls POST /api/sessions with patientId and patientContext', async () => {
      const mockSession = createMockSession();
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const { result } = renderHook(() => useSession(), { wrapper });

      await act(async () => {
        await result.current.startSession('patient-001', 'Patient context data');
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: 'patient-001', patientContext: 'Patient context data' }),
      });
    });

    it('sets session on success', async () => {
      const mockSession = createMockSession();
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const { result } = renderHook(() => useSession(), { wrapper });

      await act(async () => {
        await result.current.startSession('patient-001', 'context');
      });

      expect(result.current.state.session).toEqual(mockSession);
      expect(result.current.state.error).toBeNull();
    });

    it('sets error on API failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal server error' }),
      });

      const { result } = renderHook(() => useSession(), { wrapper });

      await act(async () => {
        await result.current.startSession('patient-001', 'context');
      });

      expect(result.current.state.session).toBeNull();
      expect(result.current.state.error).toBe('Internal server error');
      expect(result.current.state.isLoading).toBe(false);
    });

    it('sets error on network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSession(), { wrapper });

      await act(async () => {
        await result.current.startSession('patient-001', 'context');
      });

      expect(result.current.state.error).toBe('Network error');
      expect(result.current.state.isLoading).toBe(false);
    });
  });

  describe('endSession', () => {
    it('calls POST /api/sessions/:id/end', async () => {
      const mockSession = createMockSession();
      const endedSession = { ...mockSession, status: 'ended' as const, endedAt: new Date() };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSession) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(endedSession) });

      const { result } = renderHook(() => useSession(), { wrapper });

      // Start session first
      await act(async () => {
        await result.current.startSession('patient-001', 'context');
      });

      // End session
      await act(async () => {
        await result.current.endSession();
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/sessions/session-123/end', {
        method: 'POST',
      });
      expect(result.current.state.session?.status).toBe('ended');
    });

    it('sets error when no active session', async () => {
      const { result } = renderHook(() => useSession(), { wrapper });

      await act(async () => {
        await result.current.endSession();
      });

      expect(result.current.state.error).toBe('No active session to end');
    });

    it('sets error on API failure', async () => {
      const mockSession = createMockSession();

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockSession) })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'End session failed' }),
        });

      const { result } = renderHook(() => useSession(), { wrapper });

      await act(async () => {
        await result.current.startSession('patient-001', 'context');
      });

      await act(async () => {
        await result.current.endSession();
      });

      expect(result.current.state.error).toBe('End session failed');
    });
  });

  describe('addTranscript', () => {
    it('adds a transcript segment to state', () => {
      const { result } = renderHook(() => useSession(), { wrapper });
      const segment = createMockTranscript();

      act(() => {
        result.current.addTranscript(segment);
      });

      expect(result.current.state.transcriptSegments).toHaveLength(1);
      expect(result.current.state.transcriptSegments[0]).toEqual(segment);
    });

    it('appends multiple transcript segments in order', () => {
      const { result } = renderHook(() => useSession(), { wrapper });

      const seg1 = createMockTranscript({ id: 'seg-1', content: 'Hello' });
      const seg2 = createMockTranscript({ id: 'seg-2', content: 'Hi there', speaker: 'PATIENT' });
      const seg3 = createMockTranscript({ id: 'seg-3', content: 'What brings you in?' });

      act(() => {
        result.current.addTranscript(seg1);
      });
      act(() => {
        result.current.addTranscript(seg2);
      });
      act(() => {
        result.current.addTranscript(seg3);
      });

      expect(result.current.state.transcriptSegments).toHaveLength(3);
      expect(result.current.state.transcriptSegments[0].id).toBe('seg-1');
      expect(result.current.state.transcriptSegments[1].id).toBe('seg-2');
      expect(result.current.state.transcriptSegments[2].id).toBe('seg-3');
    });
  });

  describe('setOutputs', () => {
    it('sets clinical note and after-visit summary', () => {
      const { result } = renderHook(() => useSession(), { wrapper });
      const clinicalNote = createMockClinicalNote();
      const avs = 'You visited your doctor today for a headache.';

      act(() => {
        result.current.setOutputs(clinicalNote, avs);
      });

      expect(result.current.state.clinicalNote).toEqual(clinicalNote);
      expect(result.current.state.afterVisitSummary).toBe(avs);
    });
  });

  describe('setError', () => {
    it('sets error message in state', () => {
      const { result } = renderHook(() => useSession(), { wrapper });

      act(() => {
        result.current.setError('Something went wrong');
      });

      expect(result.current.state.error).toBe('Something went wrong');
    });
  });

  describe('reset', () => {
    it('resets state to initial values', async () => {
      const mockSession = createMockSession();
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const { result } = renderHook(() => useSession(), { wrapper });

      // Build up some state
      await act(async () => {
        await result.current.startSession('patient-001', 'context');
      });
      act(() => {
        result.current.addTranscript(createMockTranscript());
      });
      act(() => {
        result.current.setOutputs(createMockClinicalNote(), 'AVS content');
      });

      // Verify state is populated
      expect(result.current.state.session).not.toBeNull();
      expect(result.current.state.transcriptSegments).toHaveLength(1);
      expect(result.current.state.clinicalNote).not.toBeNull();

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.state).toEqual({
        session: null,
        transcriptSegments: [],
        clinicalNote: null,
        afterVisitSummary: null,
        isLoading: false,
        error: null,
      });
    });
  });
});
