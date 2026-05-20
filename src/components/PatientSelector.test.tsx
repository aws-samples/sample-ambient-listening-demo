/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PatientSelector, Patient } from './PatientSelector';

const mockPatients: Patient[] = [
  { id: 'patient-1', name: 'Jane Smith', dateOfBirth: '1969-03-22' },
  { id: 'patient-2', name: 'John Doe', dateOfBirth: '1985-07-15' },
  { id: 'patient-3', name: 'Alice Johnson', dateOfBirth: null },
];

describe('PatientSelector', () => {
  const mockOnSelect = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    render(<PatientSelector onSelect={mockOnSelect} />);
    expect(screen.getByRole('status', { name: /loading patients/i })).toBeInTheDocument();
    expect(screen.getByText('Loading patients…')).toBeInTheDocument();
  });

  it('displays patients after successful fetch', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockPatients,
    });

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText(/DOB: 1969-03-22/)).toBeInTheDocument();
    expect(screen.getByText(/DOB: Unknown/)).toBeInTheDocument();
  });

  it('shows error state when fetch fails with network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Error loading patients')).toBeInTheDocument();
    expect(screen.getByText('Unable to connect to the patient service. Please try again.')).toBeInTheDocument();
  });

  it('shows error state when API returns non-OK response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ code: 'FHIR_ERROR', message: 'FHIR API unavailable' }),
    });

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('FHIR API unavailable')).toBeInTheDocument();
  });

  it('retries fetch when retry button is clicked', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockPatients,
      });

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  it('filters patients by name', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockPatients,
    });

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Search patients'), {
      target: { value: 'jane' },
    });

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.queryByText('Alice Johnson')).not.toBeInTheDocument();
  });

  it('filters patients by ID', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockPatients,
    });

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Search patients'), {
      target: { value: 'patient-2' },
    });

    expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('shows "No patients found" when search has no matches', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockPatients,
    });

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Search patients'), {
      target: { value: 'zzzzz' },
    });

    expect(screen.getByText('No patients found.')).toBeInTheDocument();
  });

  it('calls onSelect when a patient is clicked', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockPatients,
    });

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Jane Smith'));

    expect(mockOnSelect).toHaveBeenCalledWith({
      id: 'patient-1',
      name: 'Jane Smith',
      dateOfBirth: '1969-03-22',
    });
  });

  it('highlights the selected patient', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockPatients,
    });

    render(<PatientSelector onSelect={mockOnSelect} selectedPatientId="patient-1" />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    const selectedOption = screen.getByRole('option', { selected: true });
    expect(selectedOption).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
  });

  it('calls onSelect on Enter key press', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockPatients,
    });

    render(<PatientSelector onSelect={mockOnSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    const firstOption = screen.getAllByRole('option')[0]!;
    fireEvent.keyDown(firstOption, { key: 'Enter' });

    expect(mockOnSelect).toHaveBeenCalledWith(mockPatients[0]);
  });
});
