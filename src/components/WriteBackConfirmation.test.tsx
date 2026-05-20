/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WriteBackConfirmation } from './WriteBackConfirmation';

describe('WriteBackConfirmation', () => {
  describe('idle state', () => {
    it('renders nothing when status is idle', () => {
      const { container } = render(<WriteBackConfirmation status="idle" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('saving state', () => {
    it('displays a saving indicator', () => {
      render(<WriteBackConfirmation status="saving" />);
      expect(
        screen.getByRole('status', { name: /saving clinical note to openemr/i })
      ).toBeInTheDocument();
    });

    it('shows saving message text', () => {
      render(<WriteBackConfirmation status="saving" />);
      expect(screen.getByText(/saving clinical note to openemr/i)).toBeInTheDocument();
    });

    it('renders a spinner animation', () => {
      const { container } = render(<WriteBackConfirmation status="saving" />);
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('success state', () => {
    it('displays a success confirmation', () => {
      render(<WriteBackConfirmation status="success" />);
      expect(
        screen.getByRole('status', { name: /clinical note saved successfully/i })
      ).toBeInTheDocument();
    });

    it('shows success message text', () => {
      render(<WriteBackConfirmation status="success" />);
      expect(
        screen.getByText(/clinical note saved to patient chart successfully/i)
      ).toBeInTheDocument();
    });

    it('renders a green success banner', () => {
      const { container } = render(<WriteBackConfirmation status="success" />);
      const banner = container.firstChild as HTMLElement;
      expect(banner).toHaveClass('bg-green-50');
      expect(banner).toHaveClass('border-green-200');
    });

    it('renders a checkmark icon', () => {
      const { container } = render(<WriteBackConfirmation status="success" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveClass('text-green-500');
    });
  });

  describe('error state', () => {
    it('displays an error alert', () => {
      render(<WriteBackConfirmation status="error" />);
      expect(
        screen.getByRole('alert', { name: /failed to save clinical note/i })
      ).toBeInTheDocument();
    });

    it('shows default error message when no error prop provided', () => {
      render(<WriteBackConfirmation status="error" />);
      expect(
        screen.getByText(/failed to save clinical note to openemr/i)
      ).toBeInTheDocument();
    });

    it('shows custom error message when error prop is provided', () => {
      render(
        <WriteBackConfirmation status="error" error="FHIR API returned 403 Forbidden" />
      );
      expect(screen.getByText('FHIR API returned 403 Forbidden')).toBeInTheDocument();
    });

    it('renders a retry button', () => {
      render(<WriteBackConfirmation status="error" />);
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = jest.fn();
      render(<WriteBackConfirmation status="error" onRetry={onRetry} retryCount={1} />);

      fireEvent.click(screen.getByRole('button', { name: /retry saving clinical note/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows retry count information', () => {
      render(<WriteBackConfirmation status="error" retryCount={2} maxRetries={3} />);
      expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument();
    });

    it('disables retry button after max retries reached', () => {
      render(<WriteBackConfirmation status="error" retryCount={3} maxRetries={3} />);
      const button = screen.getByRole('button', { name: /retry limit reached/i });
      expect(button).toBeDisabled();
    });

    it('shows max retries reached message when retries exhausted', () => {
      render(<WriteBackConfirmation status="error" retryCount={3} maxRetries={3} />);
      expect(screen.getByText('Maximum retries reached (3/3)')).toBeInTheDocument();
    });

    it('does not call onRetry when button is disabled', () => {
      const onRetry = jest.fn();
      render(
        <WriteBackConfirmation
          status="error"
          onRetry={onRetry}
          retryCount={3}
          maxRetries={3}
        />
      );

      const button = screen.getByRole('button', { name: /retry limit reached/i });
      fireEvent.click(button);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('enables retry button when retryCount is below maxRetries', () => {
      render(<WriteBackConfirmation status="error" retryCount={1} maxRetries={3} />);
      const button = screen.getByRole('button', { name: /retry saving clinical note/i });
      expect(button).not.toBeDisabled();
    });

    it('defaults maxRetries to 3', () => {
      render(<WriteBackConfirmation status="error" retryCount={3} />);
      expect(screen.getByText('Maximum retries reached (3/3)')).toBeInTheDocument();
    });

    it('defaults retryCount to 0', () => {
      render(<WriteBackConfirmation status="error" />);
      expect(screen.getByText('Attempt 0 of 3')).toBeInTheDocument();
    });

    it('renders a red error banner', () => {
      const { container } = render(<WriteBackConfirmation status="error" />);
      const banner = container.firstChild as HTMLElement;
      expect(banner).toHaveClass('bg-red-50');
      expect(banner).toHaveClass('border-red-200');
    });
  });
});
