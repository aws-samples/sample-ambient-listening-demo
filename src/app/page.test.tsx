/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Home from './page';

// Mock fetch globally for patient loading
beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => [
      { id: 'patient-1', name: 'Jane Smith', dateOfBirth: '1969-03-22' },
      { id: 'patient-2', name: 'John Doe', dateOfBirth: '1985-07-15' },
    ],
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Home Page', () => {
  it('renders without errors', async () => {
    render(<Home />);

    // Header should be visible
    expect(screen.getByText('Ambient Clinical Documentation')).toBeInTheDocument();
    expect(screen.getByText('Amazon Connect Health + OpenEMR Demo')).toBeInTheDocument();
  });

  it('renders the patient section heading', async () => {
    render(<Home />);

    expect(screen.getByText('Patient')).toBeInTheDocument();
  });

  it('renders the tabbed output panel with Clinical Note and After-Visit Summary tabs', async () => {
    render(<Home />);

    expect(screen.getByRole('tab', { name: /clinical note/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /after-visit summary/i })).toBeInTheDocument();
  });

  it('shows Clinical Note tab as active by default', async () => {
    render(<Home />);

    const clinicalNoteTab = screen.getByRole('tab', { name: /clinical note/i });
    expect(clinicalNoteTab).toHaveAttribute('aria-selected', 'true');

    const avsTab = screen.getByRole('tab', { name: /after-visit summary/i });
    expect(avsTab).toHaveAttribute('aria-selected', 'false');
  });

  it('switches to After-Visit Summary tab when clicked', async () => {
    render(<Home />);

    const avsTab = screen.getByRole('tab', { name: /after-visit summary/i });
    fireEvent.click(avsTab);

    expect(avsTab).toHaveAttribute('aria-selected', 'true');

    const clinicalNoteTab = screen.getByRole('tab', { name: /clinical note/i });
    expect(clinicalNoteTab).toHaveAttribute('aria-selected', 'false');
  });

  it('displays the transcript area with empty state message', async () => {
    render(<Home />);

    expect(
      screen.getByText(/no transcript segments yet/i)
    ).toBeInTheDocument();
  });

  it('displays patient context idle state before selection', async () => {
    render(<Home />);

    await waitFor(() => {
      expect(
        screen.getByText(/select a patient to view their clinical context/i)
      ).toBeInTheDocument();
    });
  });

  it('loads and displays patients in the selector', async () => {
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });
});
