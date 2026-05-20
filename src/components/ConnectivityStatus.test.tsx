/**
 * @jest-environment jsdom
 */

/**
 * Tests for the ConnectivityStatus component.
 *
 * @see Requirements 10.3
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConnectivityStatus } from './ConnectivityStatus';

// Mock the useConnectivityCheck hook
const mockRetry = jest.fn();
const mockUseConnectivityCheck = jest.fn();

jest.mock('@/lib/use-connectivity-check', () => ({
  useConnectivityCheck: () => mockUseConnectivityCheck(),
}));

describe('ConnectivityStatus', () => {
  beforeEach(() => {
    mockRetry.mockReset();
    mockUseConnectivityCheck.mockReset();
  });

  it('renders checking state with spinner', () => {
    mockUseConnectivityCheck.mockReturnValue({
      status: 'checking',
      error: null,
      fhirVersion: null,
      lastChecked: null,
      retry: mockRetry,
    });

    render(<ConnectivityStatus />);

    expect(screen.getByTestId('status-label')).toHaveTextContent(
      'Checking connection...'
    );
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    expect(screen.queryByTestId('connectivity-warning')).not.toBeInTheDocument();
  });

  it('renders connected state with FHIR version', () => {
    mockUseConnectivityCheck.mockReturnValue({
      status: 'connected',
      error: null,
      fhirVersion: '4.0.1',
      lastChecked: '2024-01-01T00:00:00.000Z',
      retry: mockRetry,
    });

    render(<ConnectivityStatus />);

    expect(screen.getByTestId('status-label')).toHaveTextContent(
      'Connected to OpenEMR'
    );
    expect(screen.getByTestId('status-label')).toHaveTextContent('FHIR 4.0.1');
    expect(screen.queryByTestId('connectivity-warning')).not.toBeInTheDocument();
  });

  it('renders connected state without FHIR version when not available', () => {
    mockUseConnectivityCheck.mockReturnValue({
      status: 'connected',
      error: null,
      fhirVersion: null,
      lastChecked: '2024-01-01T00:00:00.000Z',
      retry: mockRetry,
    });

    render(<ConnectivityStatus />);

    expect(screen.getByTestId('status-label')).toHaveTextContent(
      'Connected to OpenEMR'
    );
    expect(screen.getByTestId('status-label')).not.toHaveTextContent('FHIR');
  });

  it('renders disconnected state with warning banner', () => {
    mockUseConnectivityCheck.mockReturnValue({
      status: 'disconnected',
      error: 'Connection refused',
      fhirVersion: null,
      lastChecked: '2024-01-01T00:00:00.000Z',
      retry: mockRetry,
    });

    render(<ConnectivityStatus />);

    expect(screen.getByTestId('connectivity-warning')).toBeInTheDocument();
    expect(screen.getByText('OpenEMR Connection Failed')).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
    expect(screen.getByTestId('status-label')).toHaveTextContent(
      'Disconnected from OpenEMR'
    );
  });

  it('renders default error message when error is null', () => {
    mockUseConnectivityCheck.mockReturnValue({
      status: 'disconnected',
      error: null,
      fhirVersion: null,
      lastChecked: '2024-01-01T00:00:00.000Z',
      retry: mockRetry,
    });

    render(<ConnectivityStatus />);

    expect(screen.getByTestId('connectivity-warning')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Unable to connect to the FHIR API. Please check that OpenEMR is running and accessible.'
      )
    ).toBeInTheDocument();
  });

  it('calls retry when retry button is clicked', () => {
    mockUseConnectivityCheck.mockReturnValue({
      status: 'disconnected',
      error: 'Connection refused',
      fhirVersion: null,
      lastChecked: '2024-01-01T00:00:00.000Z',
      retry: mockRetry,
    });

    render(<ConnectivityStatus />);

    fireEvent.click(screen.getByTestId('retry-button'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    mockUseConnectivityCheck.mockReturnValue({
      status: 'connected',
      error: null,
      fhirVersion: '4.0.1',
      lastChecked: '2024-01-01T00:00:00.000Z',
      retry: mockRetry,
    });

    render(<ConnectivityStatus className="my-custom-class" />);

    expect(screen.getByTestId('connectivity-status')).toHaveClass(
      'my-custom-class'
    );
  });

  it('has correct status dot color for each state', () => {
    // Connected - green
    mockUseConnectivityCheck.mockReturnValue({
      status: 'connected',
      error: null,
      fhirVersion: null,
      lastChecked: null,
      retry: mockRetry,
    });

    const { rerender } = render(<ConnectivityStatus />);
    expect(screen.getByTestId('status-dot')).toHaveClass('bg-green-500');

    // Disconnected - red
    mockUseConnectivityCheck.mockReturnValue({
      status: 'disconnected',
      error: 'error',
      fhirVersion: null,
      lastChecked: null,
      retry: mockRetry,
    });

    rerender(<ConnectivityStatus />);
    expect(screen.getByTestId('status-dot')).toHaveClass('bg-red-500');

    // Checking - yellow
    mockUseConnectivityCheck.mockReturnValue({
      status: 'checking',
      error: null,
      fhirVersion: null,
      lastChecked: null,
      retry: mockRetry,
    });

    rerender(<ConnectivityStatus />);
    expect(screen.getByTestId('status-dot')).toHaveClass('bg-yellow-400');
  });

  it('warning banner has role="alert" for accessibility', () => {
    mockUseConnectivityCheck.mockReturnValue({
      status: 'disconnected',
      error: 'Connection refused',
      fhirVersion: null,
      lastChecked: null,
      retry: mockRetry,
    });

    render(<ConnectivityStatus />);

    const warning = screen.getByTestId('connectivity-warning');
    expect(warning).toHaveAttribute('role', 'alert');
    expect(warning).toHaveAttribute('aria-live', 'assertive');
  });
});
