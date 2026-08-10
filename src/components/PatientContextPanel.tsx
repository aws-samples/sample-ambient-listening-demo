'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Props for the PatientContextPanel component.
 */
export interface PatientContextPanelProps {
  patientId: string | null;
  onContextReady?: (context: string) => void;
  onContextError?: (error: string) => void;
}

interface ContextState {
  status: 'idle' | 'loading' | 'success' | 'error';
  context: string | null;
  warnings: string[];
  error: string | null;
}

/**
 * PatientContextPanel — Displays formatted patient context retrieved from the FHIR API.
 *
 * Fetches patient context (demographics, allergies, medications, conditions) from
 * `/api/patients/:id/context` when patientId changes. Shows loading state while
 * fetching, warning banners for partially failed resource types, and error state
 * if the API call fails. Blocks session start until context is loaded via the
 * onContextReady callback.
 *
 * @see Requirements 3.3, 3.5
 */
export function PatientContextPanel({
  patientId,
  onContextReady,
  onContextError,
}: PatientContextPanelProps) {
  const [state, setState] = useState<ContextState>({
    status: 'idle',
    context: null,
    warnings: [],
    error: null,
  });

  const fetchContext = useCallback(async (id: string) => {
    setState({ status: 'loading', context: null, warnings: [], error: null });

    try {
      const response = await fetch(`/api/patients/${id}/context`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const errorMessage =
          errorData?.message ?? `Failed to load patient context (HTTP ${response.status})`;
        setState({ status: 'error', context: null, warnings: [], error: errorMessage });
        onContextError?.(errorMessage);
        return;
      }

      const data: { context: string; warnings?: string[] } = await response.json();

      setState({
        status: 'success',
        context: data.context,
        warnings: data.warnings ?? [],
        error: null,
      });
      onContextReady?.(data.context);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'An unexpected error occurred';
      setState({ status: 'error', context: null, warnings: [], error: errorMessage });
      onContextError?.(errorMessage);
    }
  }, [onContextReady, onContextError]);

  useEffect(() => {
    if (!patientId) {
      setState({ status: 'idle', context: null, warnings: [], error: null });
      return;
    }

    fetchContext(patientId);
  }, [patientId, fetchContext]);

  // Idle state — no patient selected
  if (state.status === 'idle') {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-500">
          Select a patient to view their clinical context.
        </p>
      </div>
    );
  }

  // Loading state
  if (state.status === 'loading') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4" role="status" aria-label="Loading patient context">
        <div className="flex items-center space-x-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm text-gray-600">Loading patient context...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (state.status === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
        <div className="flex items-start space-x-3">
          <svg
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <div>
            <h3 className="text-sm font-medium text-red-800">
              Failed to load patient context
            </h3>
            <p className="mt-1 text-sm text-red-700">{state.error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Success state — display context with optional warnings
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      {/* Warning banners for partially failed resource types */}
      {state.warnings.length > 0 && (
        <div className="mb-3 space-y-2">
          {state.warnings.map((warning, index) => (
            <div
              key={index}
              className="flex items-start space-x-2 rounded-md border border-yellow-200 bg-yellow-50 p-3"
              role="alert"
            >
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              <p className="text-sm text-yellow-800">{warning}</p>
            </div>
          ))}
        </div>
      )}

      {/* Formatted patient context */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-900">Patient Context</h3>
        <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono leading-relaxed">
          {state.context}
        </pre>
      </div>
    </div>
  );
}
