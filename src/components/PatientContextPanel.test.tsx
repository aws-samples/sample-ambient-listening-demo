/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import { PatientContextPanel } from './PatientContextPanel';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('PatientContextPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('idle state', () => {
    it('shows placeholder when no patientId is provided', () => {
      render(<PatientContextPanel patientId={null} />);
      expect(
        screen.getByText('Select a patient to view their clinical context.')
      ).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when fetching context', async () => {
      // Never resolve the fetch to keep it in loading state
      mockFetch.mockReturnValue(new Promise(() => {}));

      render(<PatientContextPanel patientId="patient-123" />);

      expect(screen.getByText('Loading patient context...')).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('success state', () => {
    it('displays formatted patient context on successful fetch', async () => {
      const contextText = 'Name: John Doe, Age: 45, Sex: Male';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ context: contextText }),
      });

      render(<PatientContextPanel patientId="patient-123" />);

      await waitFor(() => {
        expect(screen.getByText(contextText)).toBeInTheDocument();
      });
    });

    it('calls onContextReady with context when fetch succeeds', async () => {
      const contextText = 'Name: Jane Smith\nAge: 30';
      const onContextReady = jest.fn();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ context: contextText }),
      });

      render(
        <PatientContextPanel
          patientId="patient-456"
          onContextReady={onContextReady}
        />
      );

      await waitFor(() => {
        expect(onContextReady).toHaveBeenCalledWith(contextText);
      });
    });

    it('fetches from the correct API endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ context: 'test context' }),
      });

      render(<PatientContextPanel patientId="abc-123" />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/patients/abc-123/context');
      });
    });

    it('refetches when patientId changes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ context: 'context data' }),
      });

      const { rerender } = render(
        <PatientContextPanel patientId="patient-1" />
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/patients/patient-1/context');
      });

      rerender(<PatientContextPanel patientId="patient-2" />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/patients/patient-2/context');
      });
    });
  });

  describe('warning state', () => {
    it('displays warning banners for partially failed resource types', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          context: 'Name: John Doe, Age: 45',
          warnings: ['Could not load: Conditions, Medications'],
        }),
      });

      render(<PatientContextPanel patientId="patient-789" />);

      await waitFor(() => {
        expect(
          screen.getByText('Could not load: Conditions, Medications')
        ).toBeInTheDocument();
      });

      // Context should still be displayed
      expect(screen.getByText('Name: John Doe, Age: 45')).toBeInTheDocument();
    });

    it('displays multiple warnings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          context: 'Name: Test Patient',
          warnings: [
            'Could not load: Conditions',
            'Could not load: Allergies',
          ],
        }),
      });

      render(<PatientContextPanel patientId="patient-multi" />);

      await waitFor(() => {
        expect(screen.getByText('Could not load: Conditions')).toBeInTheDocument();
        expect(screen.getByText('Could not load: Allergies')).toBeInTheDocument();
      });
    });

    it('renders warnings with alert role for accessibility', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          context: 'context',
          warnings: ['Warning message'],
        }),
      });

      render(<PatientContextPanel patientId="patient-a11y" />);

      await waitFor(() => {
        const alerts = screen.getAllByRole('alert');
        expect(alerts.length).toBeGreaterThan(0);
      });
    });
  });

  describe('error state', () => {
    it('displays error message when API returns non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: async () => ({
          message: 'FHIR API did not respond within 10 seconds',
        }),
      });

      render(<PatientContextPanel patientId="patient-err" />);

      await waitFor(() => {
        expect(
          screen.getByText('FHIR API did not respond within 10 seconds')
        ).toBeInTheDocument();
      });
    });

    it('displays generic error when API returns non-JSON error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => { throw new Error('not json'); },
      });

      render(<PatientContextPanel patientId="patient-err2" />);

      await waitFor(() => {
        expect(
          screen.getByText('Failed to load patient context (HTTP 500)')
        ).toBeInTheDocument();
      });
    });

    it('calls onContextError when fetch fails', async () => {
      const onContextError = jest.fn();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ message: 'Bad Gateway' }),
      });

      render(
        <PatientContextPanel
          patientId="patient-err3"
          onContextError={onContextError}
        />
      );

      await waitFor(() => {
        expect(onContextError).toHaveBeenCalledWith('Bad Gateway');
      });
    });

    it('handles network errors gracefully', async () => {
      const onContextError = jest.fn();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(
        <PatientContextPanel
          patientId="patient-net"
          onContextError={onContextError}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
        expect(onContextError).toHaveBeenCalledWith('Network error');
      });
    });

    it('renders error with alert role for accessibility', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server error' }),
      });

      render(<PatientContextPanel patientId="patient-a11y-err" />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('state transitions', () => {
    it('resets to idle when patientId becomes null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ context: 'some context' }),
      });

      const { rerender } = render(
        <PatientContextPanel patientId="patient-1" />
      );

      await waitFor(() => {
        expect(screen.getByText('some context')).toBeInTheDocument();
      });

      rerender(<PatientContextPanel patientId={null} />);

      expect(
        screen.getByText('Select a patient to view their clinical context.')
      ).toBeInTheDocument();
    });
  });
});
