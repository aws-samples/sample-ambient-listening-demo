'use client';

import React, { Component, ErrorInfo } from 'react';

/**
 * Error categories handled by the ErrorBoundary.
 * Each category maps to a specific stage and corrective action.
 *
 * @see Requirements 3.4, 4.5, 5.6, 5.7, 7.6, 10.4
 */
export type ErrorCategory =
  | 'session_lifecycle'
  | 'fhir_connectivity'
  | 'audio'
  | 'configuration'
  | 'unknown';

export type ErrorStage =
  | 'domain'
  | 'subscription'
  | 'session'
  | 'streaming'
  | 'fhir_timeout'
  | 'fhir_connection'
  | 'audio_permission'
  | 'audio_stream'
  | 'config'
  | 'unknown';

interface ErrorDetail {
  category: ErrorCategory;
  stage: ErrorStage;
  message: string;
  suggestedAction: string;
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorDetail: ErrorDetail | null;
}

/**
 * Classifies an error into a category and stage, providing a corrective action suggestion.
 */
export function classifyError(error: Error): ErrorDetail {
  const message = error.message || 'An unexpected error occurred';

  // Session lifecycle errors
  if (/domain/i.test(message) && /(creat|fail|error)/i.test(message)) {
    return {
      category: 'session_lifecycle',
      stage: 'domain',
      message,
      suggestedAction: 'Check IAM permissions for connecthealth:CreateDomain and verify the AWS region is us-east-1 or us-west-2.',
    };
  }
  if (/subscription/i.test(message) && /(creat|fail|error)/i.test(message)) {
    return {
      category: 'session_lifecycle',
      stage: 'subscription',
      message,
      suggestedAction: 'Verify the domain exists and check IAM permissions for connecthealth:CreateSubscription.',
    };
  }
  if (/session/i.test(message) && /(creat|fail|error|start)/i.test(message)) {
    return {
      category: 'session_lifecycle',
      stage: 'session',
      message,
      suggestedAction: 'Ensure the subscription is active and patient context is provided. Check IAM permissions for connecthealth:StartMedicalScribeListeningSession.',
    };
  }
  if (/stream/i.test(message) && /(drop|disconnect|lost|close|fail)/i.test(message)) {
    return {
      category: 'session_lifecycle',
      stage: 'streaming',
      message,
      suggestedAction: 'The audio stream was interrupted. Try restarting the session.',
    };
  }

  // FHIR connectivity errors
  if (/timeout/i.test(message) && /(fhir|ehr|openemr|patient)/i.test(message)) {
    return {
      category: 'fhir_connectivity',
      stage: 'fhir_timeout',
      message,
      suggestedAction: 'The EHR connection timed out. Verify that OpenEMR is running and accessible from the application.',
    };
  }
  if (/(connection refused|ECONNREFUSED|network|unreachable)/i.test(message) && /(fhir|ehr|openemr|patient)/i.test(message)) {
    return {
      category: 'fhir_connectivity',
      stage: 'fhir_connection',
      message,
      suggestedAction: 'Cannot connect to the FHIR API. Verify the OpenEMR stack is deployed and the FHIR base URL is correct.',
    };
  }
  // Generic FHIR errors
  if (/(fhir|ehr|openemr)/i.test(message)) {
    return {
      category: 'fhir_connectivity',
      stage: 'fhir_connection',
      message,
      suggestedAction: 'An EHR connectivity error occurred. Check the FHIR API endpoint configuration and network connectivity.',
    };
  }

  // Audio errors
  if (/(permission|denied|NotAllowedError)/i.test(message) && /(microphone|audio|media)/i.test(message)) {
    return {
      category: 'audio',
      stage: 'audio_permission',
      message,
      suggestedAction: 'Microphone access was denied. Please grant microphone permission in your browser settings and reload the page.',
    };
  }
  if (/(audio|stream|media)/i.test(message) && /(drop|lost|fail|error|disconnect)/i.test(message)) {
    return {
      category: 'audio',
      stage: 'audio_stream',
      message,
      suggestedAction: 'The audio stream was interrupted. Check your microphone connection and try restarting the session.',
    };
  }

  // Configuration errors
  if (/(env|environment|variable|config|missing)/i.test(message) && /(required|missing|undefined|not set)/i.test(message)) {
    return {
      category: 'configuration',
      stage: 'config',
      message,
      suggestedAction: 'Required configuration is missing. Check that all environment variables are set correctly. See the workshop guide for required configuration.',
    };
  }

  // Unknown/unclassified errors
  return {
    category: 'unknown',
    stage: 'unknown',
    message,
    suggestedAction: 'An unexpected error occurred. Try refreshing the page. If the problem persists, check the browser console for details.',
  };
}

/**
 * Maps error categories to user-friendly display labels.
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
      return 'Application Error';
  }
}

/**
 * Maps error stages to user-friendly display labels.
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
      return 'Unknown';
  }
}

/**
 * Maps error categories to Tailwind CSS color classes for visual distinction.
 */
function getCategoryColorClasses(category: ErrorCategory): {
  border: string;
  bg: string;
  icon: string;
  heading: string;
} {
  switch (category) {
    case 'session_lifecycle':
      return { border: 'border-orange-300', bg: 'bg-orange-50', icon: 'text-orange-500', heading: 'text-orange-800' };
    case 'fhir_connectivity':
      return { border: 'border-red-300', bg: 'bg-red-50', icon: 'text-red-500', heading: 'text-red-800' };
    case 'audio':
      return { border: 'border-yellow-300', bg: 'bg-yellow-50', icon: 'text-yellow-500', heading: 'text-yellow-800' };
    case 'configuration':
      return { border: 'border-purple-300', bg: 'bg-purple-50', icon: 'text-purple-500', heading: 'text-purple-800' };
    default:
      return { border: 'border-gray-300', bg: 'bg-gray-50', icon: 'text-gray-500', heading: 'text-gray-800' };
  }
}

/**
 * ErrorBoundary component that catches unhandled React errors and displays
 * a fallback UI with error details, stage identification, and corrective action suggestions.
 *
 * Handles:
 * - Session lifecycle errors (domain, subscription, session, streaming)
 * - FHIR connectivity errors (timeout, connection refused)
 * - Audio errors (permission denied, stream drop)
 * - Configuration errors (missing env vars)
 *
 * @see Requirements 3.4, 4.5, 5.6, 5.7, 7.6, 10.4
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorDetail: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorDetail: classifyError(error),
    };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    // Log only error metadata — full error objects may contain PHI from component state
    console.error('[ErrorBoundary] Caught error:', error.name);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, errorDetail: null });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { errorDetail } = this.state;
      if (!errorDetail) {
        return null;
      }

      const colors = getCategoryColorClasses(errorDetail.category);

      return (
        <div
          role="alert"
          aria-live="assertive"
          className={`rounded-lg border ${colors.border} ${colors.bg} p-6 shadow-sm`}
        >
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 flex-shrink-0 ${colors.icon}`} aria-hidden="true">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className={`text-lg font-semibold ${colors.heading}`}>
                {getCategoryLabel(errorDetail.category)}
              </h2>

              {/* Stage badge */}
              {errorDetail.stage !== 'unknown' && (
                <span className="mt-1 inline-block rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300">
                  Stage: {getStageLabel(errorDetail.stage)}
                </span>
              )}

              {/* Error message */}
              <p className="mt-2 text-sm text-gray-700">
                {errorDetail.message}
              </p>

              {/* Corrective action */}
              <div className="mt-3 rounded-md bg-white/60 p-3">
                <p className="text-sm font-medium text-gray-800">Suggested Action</p>
                <p className="mt-1 text-sm text-gray-600">
                  {errorDetail.suggestedAction}
                </p>
              </div>

              {/* Try Again button */}
              <button
                type="button"
                onClick={this.handleReset}
                className="mt-4 inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
