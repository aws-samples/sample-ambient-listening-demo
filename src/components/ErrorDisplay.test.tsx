/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorDisplay } from './ErrorDisplay';

describe('ErrorDisplay', () => {
  describe('rendering conditions', () => {
    it('renders nothing when no error and no message provided', () => {
      const { container } = render(<ErrorDisplay />);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when error is null', () => {
      const { container } = render(<ErrorDisplay error={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders when an Error object is provided', () => {
      render(<ErrorDisplay error={new Error('Test error')} />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('renders when a message prop is provided without an error', () => {
      render(<ErrorDisplay message="Something went wrong" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('auto-classification from Error object', () => {
    it('classifies FHIR connectivity errors and shows EHR Connection Error', () => {
      render(<ErrorDisplay error={new Error('FHIR timeout: patient data')} />);
      expect(screen.getByLabelText('EHR Connection Error')).toBeInTheDocument();
    });

    it('classifies session lifecycle errors and shows Session Error', () => {
      render(<ErrorDisplay error={new Error('Domain creation failed')} />);
      expect(screen.getByLabelText('Session Error')).toBeInTheDocument();
    });

    it('classifies audio errors and shows Audio Error', () => {
      render(<ErrorDisplay error={new Error('NotAllowedError: microphone permission denied')} />);
      expect(screen.getByLabelText('Audio Error')).toBeInTheDocument();
    });

    it('classifies configuration errors and shows Configuration Error', () => {
      render(<ErrorDisplay error={new Error('Missing required environment variables')} />);
      expect(screen.getByLabelText('Configuration Error')).toBeInTheDocument();
    });

    it('shows suggested action from classification', () => {
      render(<ErrorDisplay error={new Error('NotAllowedError: microphone permission denied')} />);
      expect(screen.getByText(/grant microphone permission/)).toBeInTheDocument();
    });
  });

  describe('pre-classified error details', () => {
    it('uses provided category over auto-classification', () => {
      render(
        <ErrorDisplay
          error={new Error('Some random error')}
          category="fhir_connectivity"
        />
      );
      expect(screen.getByLabelText('EHR Connection Error')).toBeInTheDocument();
    });

    it('uses provided stage over auto-classification', () => {
      render(
        <ErrorDisplay
          error={new Error('Some error')}
          category="session_lifecycle"
          stage="subscription"
        />
      );
      expect(screen.getByText('Subscription Setup')).toBeInTheDocument();
    });

    it('uses provided message over auto-classification', () => {
      render(
        <ErrorDisplay
          error={new Error('Original message')}
          message="Custom error message"
        />
      );
      expect(screen.getByText('Custom error message')).toBeInTheDocument();
      expect(screen.queryByText('Original message')).not.toBeInTheDocument();
    });

    it('uses provided suggestedAction over auto-classification', () => {
      render(
        <ErrorDisplay
          error={new Error('Domain creation failed')}
          suggestedAction="Custom action suggestion"
        />
      );
      expect(screen.getByText(/Custom action suggestion/)).toBeInTheDocument();
    });

    it('renders with only message prop (no Error object)', () => {
      render(
        <ErrorDisplay
          message="API returned 500"
          category="fhir_connectivity"
          stage="fhir_connection"
          suggestedAction="Check the server logs"
        />
      );
      expect(screen.getByText('API returned 500')).toBeInTheDocument();
      expect(screen.getByText(/Check the server logs/)).toBeInTheDocument();
    });
  });

  describe('stage badge display', () => {
    it('shows stage badge when stage is not unknown', () => {
      render(
        <ErrorDisplay
          message="Error"
          category="session_lifecycle"
          stage="domain"
        />
      );
      expect(screen.getByText('Domain Setup')).toBeInTheDocument();
    });

    it('does not show stage badge when stage is unknown', () => {
      render(
        <ErrorDisplay
          message="Error"
          category="unknown"
          stage="unknown"
        />
      );
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('renders in compact style when compact prop is true', () => {
      const { container } = render(
        <ErrorDisplay message="Compact error" compact />
      );
      const alert = container.firstChild as HTMLElement;
      expect(alert).toHaveClass('px-3', 'py-2', 'text-sm');
    });

    it('does not show suggested action in compact mode', () => {
      render(
        <ErrorDisplay
          error={new Error('Domain creation failed')}
          compact
        />
      );
      expect(screen.queryByText(/Suggested action/)).not.toBeInTheDocument();
    });

    it('shows retry button in compact mode when onRetry is provided', () => {
      render(
        <ErrorDisplay message="Error" compact onRetry={() => {}} />
      );
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('shows dismiss button in compact mode when onDismiss is provided', () => {
      render(
        <ErrorDisplay message="Error" compact onDismiss={() => {}} />
      );
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });
  });

  describe('retry button', () => {
    it('does not show retry button when onRetry is not provided', () => {
      render(<ErrorDisplay message="Error" />);
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('shows retry button when onRetry is provided', () => {
      render(<ErrorDisplay message="Error" onRetry={() => {}} />);
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = jest.fn();
      render(<ErrorDisplay message="Error" onRetry={onRetry} />);
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('disables retry button when retryCount reaches maxRetries', () => {
      render(
        <ErrorDisplay message="Error" onRetry={() => {}} retryCount={3} maxRetries={3} />
      );
      const button = screen.getByRole('button', { name: /retry limit reached/i });
      expect(button).toBeDisabled();
    });

    it('enables retry button when retryCount is below maxRetries', () => {
      render(
        <ErrorDisplay message="Error" onRetry={() => {}} retryCount={1} maxRetries={3} />
      );
      const button = screen.getByRole('button', { name: /retry/i });
      expect(button).not.toBeDisabled();
    });

    it('shows retry count information', () => {
      render(
        <ErrorDisplay message="Error" onRetry={() => {}} retryCount={2} maxRetries={3} />
      );
      expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument();
    });

    it('defaults maxRetries to 3', () => {
      render(
        <ErrorDisplay message="Error" onRetry={() => {}} retryCount={3} />
      );
      const button = screen.getByRole('button', { name: /retry limit reached/i });
      expect(button).toBeDisabled();
    });
  });

  describe('dismiss button', () => {
    it('does not show dismiss button when onDismiss is not provided', () => {
      render(<ErrorDisplay message="Error" />);
      expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });

    it('shows dismiss button when onDismiss is provided', () => {
      render(<ErrorDisplay message="Error" onDismiss={() => {}} />);
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('calls onDismiss when dismiss button is clicked', () => {
      const onDismiss = jest.fn();
      render(<ErrorDisplay message="Error" onDismiss={onDismiss} />);
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('has role="alert" in standard mode', () => {
      render(<ErrorDisplay message="Error" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('has role="alert" in compact mode', () => {
      render(<ErrorDisplay message="Error" compact />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('has aria-live="assertive" in standard mode', () => {
      render(<ErrorDisplay message="Error" />);
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    });

    it('has aria-live="polite" in compact mode', () => {
      render(<ErrorDisplay message="Error" compact />);
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-label matching the category label', () => {
      render(<ErrorDisplay message="Error" category="audio" />);
      expect(screen.getByLabelText('Audio Error')).toBeInTheDocument();
    });
  });

  describe('color coding by category', () => {
    it('applies orange colors for session_lifecycle errors', () => {
      const { container } = render(
        <ErrorDisplay message="Error" category="session_lifecycle" />
      );
      const alert = container.firstChild as HTMLElement;
      expect(alert).toHaveClass('border-orange-300', 'bg-orange-50');
    });

    it('applies red colors for fhir_connectivity errors', () => {
      const { container } = render(
        <ErrorDisplay message="Error" category="fhir_connectivity" />
      );
      const alert = container.firstChild as HTMLElement;
      expect(alert).toHaveClass('border-red-300', 'bg-red-50');
    });

    it('applies yellow colors for audio errors', () => {
      const { container } = render(
        <ErrorDisplay message="Error" category="audio" />
      );
      const alert = container.firstChild as HTMLElement;
      expect(alert).toHaveClass('border-yellow-300', 'bg-yellow-50');
    });

    it('applies purple colors for configuration errors', () => {
      const { container } = render(
        <ErrorDisplay message="Error" category="configuration" />
      );
      const alert = container.firstChild as HTMLElement;
      expect(alert).toHaveClass('border-purple-300', 'bg-purple-50');
    });

    it('applies gray colors for unknown errors', () => {
      const { container } = render(
        <ErrorDisplay message="Error" category="unknown" />
      );
      const alert = container.firstChild as HTMLElement;
      expect(alert).toHaveClass('border-gray-300', 'bg-gray-50');
    });
  });
});
