/**
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { useWriteBack } from './use-writeback';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('useWriteBack', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useWriteBack());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.retryCount).toBe(0);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.documentId).toBeNull();
  });

  it('transitions to saving state when writeBack is called', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, documentId: 'doc-123' }),
    });

    const { result } = renderHook(() => useWriteBack());

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-1',
        patientId: 'patient-1',
        clinicalNote: 'Test note',
        sessionDate: '2024-01-01',
      });
    });

    // After resolution, should be success
    expect(result.current.state.status).toBe('success');
    expect(result.current.state.documentId).toBe('doc-123');
  });

  it('calls the correct API endpoint with proper payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, documentId: 'doc-456' }),
    });

    const { result } = renderHook(() => useWriteBack());

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-abc',
        patientId: 'patient-xyz',
        clinicalNote: 'SOAP note content',
        sessionDate: '2024-06-15',
      });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/session-abc/writeback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: 'patient-xyz',
        clinicalNote: 'SOAP note content',
        sessionDate: '2024-06-15',
      }),
    });
  });

  it('transitions to error state on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ message: 'FHIR write failed: 502 Bad Gateway' }),
    });

    const { result } = renderHook(() => useWriteBack());

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-1',
        patientId: 'patient-1',
        clinicalNote: 'Test note',
        sessionDate: '2024-01-01',
      });
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('FHIR write failed: 502 Bad Gateway');
    expect(result.current.state.retryCount).toBe(0);
  });

  it('transitions to error state on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useWriteBack());

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-1',
        patientId: 'patient-1',
        clinicalNote: 'Test note',
        sessionDate: '2024-01-01',
      });
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('Network error');
  });

  it('increments retryCount on retry', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error again' }),
      });

    const { result } = renderHook(() => useWriteBack());

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-1',
        patientId: 'patient-1',
        clinicalNote: 'Test note',
        sessionDate: '2024-01-01',
      });
    });

    expect(result.current.state.retryCount).toBe(0);

    await act(async () => {
      result.current.retry();
    });

    // Wait for the async operation to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.state.retryCount).toBe(1);
  });

  it('succeeds on retry after initial failure', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, documentId: 'doc-retry' }),
      });

    const { result } = renderHook(() => useWriteBack());

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-1',
        patientId: 'patient-1',
        clinicalNote: 'Test note',
        sessionDate: '2024-01-01',
      });
    });

    expect(result.current.state.status).toBe('error');

    await act(async () => {
      result.current.retry();
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.state.status).toBe('success');
    expect(result.current.state.documentId).toBe('doc-retry');
  });

  it('does not retry when max retries reached', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Server error' }),
    });

    const { result } = renderHook(() => useWriteBack({ maxRetries: 2 }));

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-1',
        patientId: 'patient-1',
        clinicalNote: 'Test note',
        sessionDate: '2024-01-01',
      });
    });

    // First retry
    await act(async () => {
      result.current.retry();
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Second retry
    await act(async () => {
      result.current.retry();
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.state.retryCount).toBe(2);

    // Third retry should be blocked (maxRetries = 2)
    const fetchCallCount = mockFetch.mock.calls.length;
    await act(async () => {
      result.current.retry();
    });

    expect(mockFetch.mock.calls.length).toBe(fetchCallCount);
  });

  it('resets state to idle', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, documentId: 'doc-123' }),
    });

    const { result } = renderHook(() => useWriteBack());

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-1',
        patientId: 'patient-1',
        clinicalNote: 'Test note',
        sessionDate: '2024-01-01',
      });
    });

    expect(result.current.state.status).toBe('success');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.retryCount).toBe(0);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.documentId).toBeNull();
  });

  it('uses default maxRetries of 3', () => {
    const { result } = renderHook(() => useWriteBack());
    expect(result.current.state.maxRetries).toBe(3);
  });

  it('respects custom maxRetries option', () => {
    const { result } = renderHook(() => useWriteBack({ maxRetries: 5 }));
    expect(result.current.state.maxRetries).toBe(5);
  });

  it('handles non-JSON error response gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('Not JSON'); },
    });

    const { result } = renderHook(() => useWriteBack());

    await act(async () => {
      await result.current.writeBack({
        sessionId: 'session-1',
        patientId: 'patient-1',
        clinicalNote: 'Test note',
        sessionDate: '2024-01-01',
      });
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('Write-back failed with status 500');
  });
});
