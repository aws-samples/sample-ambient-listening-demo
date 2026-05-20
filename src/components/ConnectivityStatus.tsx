/**
 * ConnectivityStatus component — displays OpenEMR FHIR API connection status.
 *
 * Shows a status indicator (connected/disconnected/checking) and a warning banner
 * if the FHIR API is unreachable. Includes a manual retry button.
 *
 * @see Requirements 10.3
 */

'use client';

import React from 'react';
import { useConnectivityCheck, ConnectionStatus } from '@/lib/use-connectivity-check';

/** Props for the ConnectivityStatus component */
export interface ConnectivityStatusProps {
  /** Optional CSS class name for the container */
  className?: string;
}

/** Status indicator dot colors */
const STATUS_COLORS: Record<ConnectionStatus, string> = {
  checking: 'bg-yellow-400',
  connected: 'bg-green-500',
  disconnected: 'bg-red-500',
};

/** Status labels */
const STATUS_LABELS: Record<ConnectionStatus, string> = {
  checking: 'Checking connection...',
  connected: 'Connected to OpenEMR',
  disconnected: 'Disconnected from OpenEMR',
};

/**
 * Displays the current OpenEMR FHIR API connection status.
 * Shows a warning banner when disconnected with a retry button.
 */
export function ConnectivityStatus({ className = '' }: ConnectivityStatusProps) {
  const { status, error, fhirVersion, retry } = useConnectivityCheck();

  return (
    <div className={className} data-testid="connectivity-status">
      {/* Warning banner when disconnected */}
      {status === 'disconnected' && (
        <div
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4"
          role="alert"
          aria-live="assertive"
          data-testid="connectivity-warning"
        >
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-red-400"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800">
                OpenEMR Connection Failed
              </h3>
              <p className="mt-1 text-sm text-red-700">
                {error ?? 'Unable to connect to the FHIR API. Please check that OpenEMR is running and accessible.'}
              </p>
            </div>
            <div className="ml-3 flex-shrink-0">
              <button
                type="button"
                onClick={retry}
                className="rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                data-testid="retry-button"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compact status indicator */}
      <div className="flex items-center gap-2" data-testid="status-indicator">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLORS[status]}`}
          aria-hidden="true"
          data-testid="status-dot"
        />
        <span className="text-sm text-gray-600" data-testid="status-label">
          {STATUS_LABELS[status]}
          {status === 'connected' && fhirVersion && (
            <span className="ml-1 text-gray-400">(FHIR {fhirVersion})</span>
          )}
        </span>
        {status === 'checking' && (
          <svg
            className="h-4 w-4 animate-spin text-yellow-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-label="Loading"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
