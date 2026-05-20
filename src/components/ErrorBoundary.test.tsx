/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBoundary, classifyError } from './ErrorBoundary';

// Suppress console.error from ErrorBoundary's componentDidCatch during tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
});

/** Helper component that throws an error on render */
function ThrowingComponent({ error }: { error: Error }) {
  throw error;
}

/** Helper component that renders normally */
function NormalComponent() {
  return <div>Normal content</div>;
}

describe('ErrorBoundary', () => {
  describe('normal rendering', () => {
    it('renders children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <NormalComponent />
        </ErrorBoundary>
      );
      expect(screen.getByText('Normal content')).toBeInTheDocument();
    });

    it('does not display error UI when no error occurs', () => {
      render(
        <ErrorBoundary>
          <NormalComponent />
        </ErrorBoundary>
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('error catching', () => {
    it('displays error UI when a child throws', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Something went wrong')} />
        </ErrorBoundary>
      );
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('displays the error message', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Test error message')} />
        </ErrorBoundary>
      );
      expect(screen.getByText('Test error message')).toBeInTheDocument();
    });

    it('displays a Try Again button', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Some error')} />
        </ErrorBoundary>
      );
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('renders custom fallback when provided', () => {
      render(
        <ErrorBoundary fallback={<div>Custom fallback</div>}>
          <ThrowingComponent error={new Error('Some error')} />
        </ErrorBoundary>
      );
      expect(screen.getByText('Custom fallback')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });
  });

  describe('session lifecycle error display', () => {
    it('shows Session Error heading for domain creation failures', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Failed to create domain')} />
        </ErrorBoundary>
      );
      expect(screen.getByText('Session Error')).toBeInTheDocument();
    });

    it('shows Domain Setup stage for domain errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Domain creation failed')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/Domain Setup/)).toBeInTheDocument();
    });

    it('suggests checking IAM permissions for domain errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Domain creation failed')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/IAM permissions/)).toBeInTheDocument();
    });

    it('shows Subscription Setup stage for subscription errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Subscription creation error')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/Subscription Setup/)).toBeInTheDocument();
    });

    it('shows Session Creation stage for session errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Session creation failed')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/Session Creation/)).toBeInTheDocument();
    });

    it('shows Audio Streaming stage for stream drop errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Stream connection dropped')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/Audio Streaming/)).toBeInTheDocument();
    });
  });

  describe('FHIR connectivity error display', () => {
    it('shows EHR Connection Error heading for FHIR timeout', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('FHIR API timeout: patient data request')} />
        </ErrorBoundary>
      );
      expect(screen.getByText('EHR Connection Error')).toBeInTheDocument();
    });

    it('suggests checking OpenEMR for connection errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('ECONNREFUSED: FHIR API unreachable')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/OpenEMR/)).toBeInTheDocument();
    });
  });

  describe('audio error display', () => {
    it('shows Audio Error heading for microphone permission denial', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('NotAllowedError: microphone permission denied')} />
        </ErrorBoundary>
      );
      expect(screen.getByText('Audio Error')).toBeInTheDocument();
    });

    it('shows Microphone Permission stage for permission errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('NotAllowedError: microphone permission denied')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/Microphone Permission/)).toBeInTheDocument();
    });

    it('suggests granting microphone access for permission errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('NotAllowedError: microphone permission denied')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/grant microphone permission/)).toBeInTheDocument();
    });
  });

  describe('configuration error display', () => {
    it('shows Configuration Error heading for missing env vars', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Missing required environment variables: AWS_REGION')} />
        </ErrorBoundary>
      );
      expect(screen.getByText('Configuration Error')).toBeInTheDocument();
    });

    it('suggests checking environment variables for config errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Missing required environment variables: AWS_REGION')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/Check that all environment variables are set correctly/)).toBeInTheDocument();
    });
  });

  describe('unknown error display', () => {
    it('shows Application Error heading for unclassified errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Something completely unexpected')} />
        </ErrorBoundary>
      );
      expect(screen.getByText('Application Error')).toBeInTheDocument();
    });

    it('suggests refreshing the page for unknown errors', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent error={new Error('Something completely unexpected')} />
        </ErrorBoundary>
      );
      expect(screen.getByText(/refreshing the page/)).toBeInTheDocument();
    });
  });

  describe('Try Again button', () => {
    it('resets the error boundary and re-renders children', () => {
      let shouldThrow = true;

      function ConditionalThrower() {
        if (shouldThrow) {
          throw new Error('Temporary error');
        }
        return <div>Recovered content</div>;
      }

      render(
        <ErrorBoundary>
          <ConditionalThrower />
        </ErrorBoundary>
      );

      // Error state is shown
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Fix the condition and click Try Again
      shouldThrow = false;
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      // Should now show recovered content
      expect(screen.getByText('Recovered content')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});

describe('classifyError', () => {
  it('classifies domain creation errors as session_lifecycle/domain', () => {
    const result = classifyError(new Error('Failed to create domain'));
    expect(result.category).toBe('session_lifecycle');
    expect(result.stage).toBe('domain');
  });

  it('classifies subscription errors as session_lifecycle/subscription', () => {
    const result = classifyError(new Error('Subscription creation error'));
    expect(result.category).toBe('session_lifecycle');
    expect(result.stage).toBe('subscription');
  });

  it('classifies session start errors as session_lifecycle/session', () => {
    const result = classifyError(new Error('Session start failed'));
    expect(result.category).toBe('session_lifecycle');
    expect(result.stage).toBe('session');
  });

  it('classifies stream drop errors as session_lifecycle/streaming', () => {
    const result = classifyError(new Error('Stream connection dropped'));
    expect(result.category).toBe('session_lifecycle');
    expect(result.stage).toBe('streaming');
  });

  it('classifies FHIR timeout errors as fhir_connectivity/fhir_timeout', () => {
    const result = classifyError(new Error('FHIR timeout: patient data'));
    expect(result.category).toBe('fhir_connectivity');
    expect(result.stage).toBe('fhir_timeout');
  });

  it('classifies FHIR connection refused errors as fhir_connectivity/fhir_connection', () => {
    const result = classifyError(new Error('ECONNREFUSED: FHIR API'));
    expect(result.category).toBe('fhir_connectivity');
    expect(result.stage).toBe('fhir_connection');
  });

  it('classifies generic FHIR errors as fhir_connectivity/fhir_connection', () => {
    const result = classifyError(new Error('OpenEMR returned 500'));
    expect(result.category).toBe('fhir_connectivity');
    expect(result.stage).toBe('fhir_connection');
  });

  it('classifies microphone permission errors as audio/audio_permission', () => {
    const result = classifyError(new Error('NotAllowedError: microphone permission denied'));
    expect(result.category).toBe('audio');
    expect(result.stage).toBe('audio_permission');
  });

  it('classifies audio device failures as audio/audio_stream', () => {
    // The audio classification requires audio/media keywords without "stream" alone
    // (since "stream" + drop/fail matches session_lifecycle/streaming first)
    const result = classifyError(new Error('Audio device error: media failed'));
    expect(result.category).toBe('audio');
    expect(result.stage).toBe('audio_stream');
  });

  it('classifies missing env var errors as configuration/config', () => {
    const result = classifyError(new Error('Missing required environment variables'));
    expect(result.category).toBe('configuration');
    expect(result.stage).toBe('config');
  });

  it('classifies unrecognized errors as unknown/unknown', () => {
    const result = classifyError(new Error('Something completely random'));
    expect(result.category).toBe('unknown');
    expect(result.stage).toBe('unknown');
  });

  it('always provides a non-empty suggestedAction', () => {
    const errors = [
      new Error('Domain creation failed'),
      new Error('Subscription error'),
      new Error('Session start failed'),
      new Error('FHIR timeout: patient'),
      new Error('NotAllowedError: microphone permission denied'),
      new Error('Missing required environment variables'),
      new Error('Random error'),
    ];

    for (const error of errors) {
      const result = classifyError(error);
      expect(result.suggestedAction).toBeTruthy();
      expect(result.suggestedAction.length).toBeGreaterThan(0);
    }
  });

  it('handles errors with empty message', () => {
    const result = classifyError(new Error(''));
    expect(result.category).toBe('unknown');
    expect(result.message).toBe('An unexpected error occurred');
  });
});
