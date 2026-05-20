'use client';

import React from 'react';
import { classifyError, ErrorCategory, ErrorStage } from './ErrorBoundary';

/**
 * Props for the ErrorDisplay component.
 * Accepts either a raw Error object (which will be classified) or pre-classified error details.
 */
export interface ErrorDisplayProps {
  /** The error to display. Can be an Error object or a pre-classified error detail. */
  error?: Error | null;
  /** Pre-classified error category (overrides auto-classification). */
  category?: ErrorCategory;
  /** Pre-classified error stage (overrides auto-classification). */
  stage?: ErrorStage;
  /** Custom error message (overrides auto-classification). */
  message?: string;
  /** Custom suggested action (overrides auto-classification). */
  suggestedAction?: string;
  /** Whether to show the error in a compact inline style. Defaults to false. */
  compact?: boolean;
  /** Optional callback when the dismiss button is clicked. If not provided, dismiss button is hidden. */
  onDismiss?: () => void;
  /** Optional callback when the retry button is clicked. If not provided, retry button is hidden. */
  onRetry?: () => void;
  /** Optional retry count for display. */
  retryCount?: number;
  /** Optional max retries for display. */
  maxRetries?: number;
}

/**
 * Maps error categories to Tailwind CSS color classes for visual distinction.
 */
function getCategoryColors(category: ErrorCategory): {
  border: string;
  bg: string;
  icon: string;
  text: string;
} {
  switch (category) {
    case 'session_lifecycle':
      return { border: 'border-orange-300', bg: 'bg-orange-50', icon: 'text-orange-500', text: 'text-orange-800' };
    case 'fhir_connectivity':
      return { border: 'border-red-300', bg: 'bg-red-50', icon: 'text-red-500', text: 'text-red-800' };
    case 'audio':
      return { border: 'border-yellow-300', bg: 'bg-yellow-50', icon: 'text-yellow-600', text: 'text-yellow-800' };
    case 'configuration':
      return { border: 'border-purple-300', bg: 'bg-purple-50', icon: 'text-purple-500', text: 'text-purple-800' };
    default:
      return { border: 'border-gray-300', bg: 'bg-gray-50', icon: 'text-gray-500', text: 'text-gray-800' };
  }
}

/**
 * Maps error categories to user-friendly labels.
 */
function getCategoryLabel(category: ErrorCategory): string {
  switch (category) {
    case 'session_lifecycle':
      return 'Session Error';
    case 'fhir_connectivity':
      return 'EHR Connection Error';
    case 'audio':
      return 'Audio Error';
    case 'configuration':
      return 'Configuration Error';
    default:
      return 'Error';
  }
}

/**
 * Maps error stages to user-friendly labels.
 */
function getStageLabel(stage: ErrorStage): string {
  switch (stage) {
    case 'domain':
      return 'Domain Setup';
    case 'subscription':
      return 'Subscription Setup';
    case 'session':
      return 'Session Creation';
    case 'streaming':
      return 'Audio Streaming';
    case 'fhir_timeout':
      return 'FHIR API Timeout';
    case 'fhir_connection':
      return 'FHIR API Connection';
    case 'audio_permission':
      return 'Microphone Permission';
    case 'audio_stream':
      return 'Audio Stream';
    case 'config':
      return 'Configuration';
    default:
      return '';
  }
}

/**
 * ErrorDisplay component for showing non-boundary errors inline in the UI.
 * Unlike ErrorBoundary (which catches unhandled React errors), ErrorDisplay is used
 * for controlled error states — e.g., API call failures, validation errors, or
 * connection issues that don't crash the component tree.
 *
 * Features:
 * - Auto-classifies Error objects into categories with corrective action suggestions
 * - Supports pre-classified error details for known error states
 * - Compact mode for inline display within other components
 * - Optional dismiss and retry buttons
 * - Accessible with role="alert" and aria-live
 *
 * @see Requirements 3.4, 4.5, 5.6, 5.7, 7.6, 10.4
 */
export function ErrorDisplay({
  error,
  category: propCategory,
  stage: propStage,
  message: propMessage,
  suggestedAction: propSuggestedAction,
  compact = false,
  onDismiss,
  onRetry,
  retryCount,
  maxRetries = 3,
}: ErrorDisplayProps) {
  // If no error and no explicit message, render nothing
  if (!error && !propMessage) {
    return null;
  }

  // Classify the error if an Error object is provided
  const classified = error ? classifyError(error) : null;

  // Use props if provided, otherwise fall back to classified values
  const category = propCategory ?? classified?.category ?? 'unknown';
  const stage = propStage ?? classified?.stage ?? 'unknown';
  const message = propMessage ?? classified?.message ?? 'An unexpected error occurred';
  const suggestedAction = propSuggestedAction ?? classified?.suggestedAction ?? '';

  const colors = getCategoryColors(category);
  const categoryLabel = getCategoryLabel(category);
  const stageLabel = getStageLabel(stage);

  const isRetryDisabled = retryCount !== undefined && retryCount >= maxRetries;

  if (compact) {
    return (
      <div
        role="alert"
        aria-live="polite"
        aria-label={categoryLabel}
        className={`flex items-center gap-2 rounded border ${colors.border} ${colors.bg} px-3 py-2 text-sm`}
      >
        <svg
          className={`h-4 w-4 flex-shrink-0 ${colors.icon}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
          />
        </svg>
        <span className={colors.text}>{message}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetryDisabled}
            aria-label={isRetryDisabled ? 'Retry limit reached' : 'Retry'}
            className="ml-auto text-xs font-medium text-gray-700 underline hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
          >
            Retry
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="ml-1 text-gray-400 hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-label={categoryLabel}
      className={`rounded-lg border ${colors.border} ${colors.bg} p-4 shadow-sm`}
    >
      <div className="flex items-start gap-3">
        <svg
          className={`mt-0.5 h-5 w-5 flex-shrink-0 ${colors.icon}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className={`text-sm font-semibold ${colors.text}`}>{categoryLabel}</h3>
            {stageLabel && stage !== 'unknown' && (
              <span className="inline-block rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-300">
                {stageLabel}
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-gray-700">{message}</p>

          {suggestedAction && (
            <p className="mt-2 text-xs text-gray-600">
              <span className="font-medium">Suggested action:</span> {suggestedAction}
            </p>
          )}

          {(retryCount !== undefined || onRetry || onDismiss) && (
            <div className="mt-3 flex items-center gap-3">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={isRetryDisabled}
                  aria-label={isRetryDisabled ? 'Retry limit reached' : 'Retry'}
                  className="inline-flex items-center rounded-md bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Retry
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Dismiss error"
                  className="text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  Dismiss
                </button>
              )}
              {retryCount !== undefined && (
                <span className="text-xs text-gray-500">
                  Attempt {retryCount} of {maxRetries}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ErrorDisplay;
