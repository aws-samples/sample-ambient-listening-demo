/**
 * React hook for checking OpenEMR FHIR API connectivity on application startup.
 *
 * On mount, calls the /api/health endpoint to verify OpenEMR is reachable.
 * Exposes connection status (checking/connected/disconnected) and a manual retry function.
 *
 * @see Requirements 10.3
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

export type ConnectionStatus = 'checking' | 'connected' | 'disconnected';

export interface ConnectivityState {
  /** Current connection status */
  status: ConnectionStatus;
  /** Error message if disconnected */
  error: string | null;
  /** FHIR version reported by the server */
  fhirVersion: string | null;
  /** Timestamp of the last check */
  lastChecked: string | null;
  /** Manually retry the connectivity check */
  retry: () => void;
}

/**
 * Hook that performs a FHIR metadata request on mount to verify OpenEMR connectivity.
 * Returns the current connection status and a retry function.
 */
export function useConnectivityCheck(): ConnectivityState {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [error, setError] = useState<string | null>(null);
  const [fhirVersion, setFhirVersion] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const checkConnectivity = useCallback(async () => {
    setStatus('checking');
    setError(null);

    try {
      const response = await fetch('/api/health');
      const data = await response.json();

      if (response.ok && data.status === 'connected') {
        setStatus('connected');
        setFhirVersion(data.fhirVersion ?? null);
      } else {
        setStatus('disconnected');
        setError(data.error ?? 'Unable to connect to OpenEMR FHIR API');
      }

      setLastChecked(data.timestamp ?? new Date().toISOString());
    } catch (err) {
      setStatus('disconnected');
      setError(
        err instanceof Error
          ? err.message
          : 'Network error: unable to reach health check endpoint'
      );
      setLastChecked(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    checkConnectivity();
  }, [checkConnectivity]);

  return {
    status,
    error,
    fhirVersion,
    lastChecked,
    retry: checkConnectivity,
  };
}
