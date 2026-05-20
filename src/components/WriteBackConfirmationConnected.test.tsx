/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WriteBackConfirmationConnected } from './WriteBackConfirmation';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('WriteBackConfirmationConnected', () => {
  const defaultProps = {
    sessionId: 'session-123',
    patientId: 'patient-456',
    clinicalNote: 'Subjective: Patient reports headache.',
    sessionDate: '2024-01-15T10:00:00Z',
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('automatically triggers write-back on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, documentId: 'doc-1' }),
    });

    render(<WriteBackConfirmationConnected {...defaultProps} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/session-123/writeback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: 'patient-456',
          clinicalNote: 'Subjective: Patient reports headache.',
          sessionDate: '2024-01-15T10:00:00Z',
        }),
      });
    });
  });

  it('shows success message after successful write-back', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, documentId: 'doc-1' }),
    });

    render(<WriteBackConfirmationConnected {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByText(/clinical note saved to patient chart successfully/i)
      ).toBeInTheDocument();
    });
  });

  it('shows error message on write-back failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ message: 'FHIR API timeout' }),
    });

    render(<WriteBackConfirmationConnected {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('FHIR API timeout')).toBeInTheDocument();
    });
  });

  it('shows retry button on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Server error' }),
    });

    render(<WriteBackConfirmationConnected {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });

  it('retries write-back when retry button is clicked', async () => {
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

    render(<WriteBackConfirmationConnected {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry saving clinical note/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /retry saving clinical note/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/clinical note saved to patient chart successfully/i)
      ).toBeInTheDocument();
    });
  });

  it('disables retry after 3 failed attempts', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Persistent error' }),
    });

    render(<WriteBackConfirmationConnected {...defaultProps} />);

    // Wait for initial failure
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry saving clinical note/i })).toBeInTheDocument();
    });

    // Retry 1
    fireEvent.click(screen.getByRole('button', { name: /retry saving clinical note/i }));
    await waitFor(() => {
      expect(screen.getByText('Attempt 1 of 3')).toBeInTheDocument();
    });

    // Retry 2
    fireEvent.click(screen.getByRole('button', { name: /retry saving clinical note/i }));
    await waitFor(() => {
      expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument();
    });

    // Retry 3
    fireEvent.click(screen.getByRole('button', { name: /retry saving clinical note/i }));
    await waitFor(() => {
      expect(screen.getByText('Maximum retries reached (3/3)')).toBeInTheDocument();
    });

    // Button should be disabled
    expect(screen.getByRole('button', { name: /retry limit reached/i })).toBeDisabled();
  });

  it('does not auto-trigger when autoTrigger is false', () => {
    render(<WriteBackConfirmationConnected {...defaultProps} autoTrigger={false} />);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls onSuccess callback when write-back succeeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, documentId: 'doc-success' }),
    });

    const onSuccess = jest.fn();
    render(<WriteBackConfirmationConnected {...defaultProps} onSuccess={onSuccess} />);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('doc-success');
    });
  });

  it('calls onPermanentFailure when max retries exhausted', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Persistent failure' }),
    });

    const onPermanentFailure = jest.fn();
    render(
      <WriteBackConfirmationConnected {...defaultProps} onPermanentFailure={onPermanentFailure} />
    );

    // Wait for initial failure
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry saving clinical note/i })).toBeInTheDocument();
    });

    // Retry 3 times
    fireEvent.click(screen.getByRole('button', { name: /retry saving clinical note/i }));
    await waitFor(() => {
      expect(screen.getByText('Attempt 1 of 3')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /retry saving clinical note/i }));
    await waitFor(() => {
      expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /retry saving clinical note/i }));
    await waitFor(() => {
      expect(onPermanentFailure).toHaveBeenCalledWith('Persistent failure');
    });
  });
});
