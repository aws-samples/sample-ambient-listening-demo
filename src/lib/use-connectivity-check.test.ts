/**
 * @jest-environment jsdom
 */

/**
 * Tests for the useConnectivityCheck hook.
 *
 * @see Requirements 10.3
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { useConnectivityCheck } from './use-connectivity-check';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('useConnectivityCheck', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('starts with "checking" status', () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'connected',
        fhirVersion: '4.0.1',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    const { result } = renderHook(() => useConnectivityCheck());
    expect(result.current.status).toBe('checking');
  });

  it('transitions to "connected" when health check succeeds', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'connected',
        fhirVersion: '4.0.1',
        fhirStatus: 'active',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    const { result } = renderHook(() => useConnectivityCheck());

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(result.current.fhirVersion).toBe('4.0.1');
    expect(result.current.error).toBeNull();
    expect(result.current.lastChecked).toBe('2024-01-01T00:00:00.000Z');
  });

  it('transitions to "disconnected" when health check returns error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        status: 'disconnected',
        error: 'Failed to connect to FHIR API',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    const { result } = renderHook(() => useConnectivityCheck());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });

    expect(result.current.error).toBe('Failed to connect to FHIR API');
    expect(result.current.fhirVersion).toBeNull();
  });

  it('transitions to "disconnected" on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useConnectivityCheck());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });

    expect(result.current.error).toBe('Network error');
  });

  it('transitions to "disconnected" on non-Error throw', async () => {
    mockFetch.mockRejectedValue('something went wrong');

    const { result } = renderHook(() => useConnectivityCheck());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });

    expect(result.current.error).toBe(
      'Network error: unable to reach health check endpoint'
    );
  });

  it('retry function re-checks connectivity', async () => {
    // First call fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        status: 'disconnected',
        error: 'Connection refused',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    const { result } = renderHook(() => useConnectivityCheck());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });

    // Second call succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'connected',
        fhirVersion: '4.0.1',
        timestamp: '2024-01-01T00:01:00.000Z',
      }),
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(result.current.fhirVersion).toBe('4.0.1');
    expect(result.current.error).toBeNull();
  });

  it('calls /api/health endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'connected',
        fhirVersion: '4.0.1',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
    });

    renderHook(() => useConnectivityCheck());

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/health');
    });
  });
});
