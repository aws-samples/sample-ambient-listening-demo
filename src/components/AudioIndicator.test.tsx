/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AudioIndicator } from './AudioIndicator';

describe('AudioIndicator', () => {
  it('shows "Not recording" with gray dot when inactive', () => {
    render(<AudioIndicator isActive={false} />);

    expect(screen.getByRole('status', { name: /audio is not active/i })).toBeInTheDocument();
    expect(screen.getByText('Not recording')).toBeInTheDocument();
  });

  it('shows "Recording" with pulsing red dot when active with microphone source', () => {
    render(<AudioIndicator isActive={true} source="microphone" />);

    expect(screen.getByRole('status', { name: /audio recording is active/i })).toBeInTheDocument();
    expect(screen.getByText('Recording')).toBeInTheDocument();
  });

  it('shows "Streaming" when active with wav source', () => {
    render(<AudioIndicator isActive={true} source="wav" />);

    expect(screen.getByRole('status', { name: /audio streaming is active/i })).toBeInTheDocument();
    expect(screen.getByText('Streaming')).toBeInTheDocument();
  });

  it('defaults to microphone source when not specified', () => {
    render(<AudioIndicator isActive={true} />);

    expect(screen.getByText('Recording')).toBeInTheDocument();
  });

  it('renders the ping animation element when active', () => {
    const { container } = render(<AudioIndicator isActive={true} />);

    const pingElement = container.querySelector('.animate-ping');
    expect(pingElement).toBeInTheDocument();
  });

  it('does not render the ping animation element when inactive', () => {
    const { container } = render(<AudioIndicator isActive={false} />);

    const pingElement = container.querySelector('.animate-ping');
    expect(pingElement).not.toBeInTheDocument();
  });

  it('applies red color to the dot when active', () => {
    const { container } = render(<AudioIndicator isActive={true} />);

    const dot = container.querySelector('.bg-red-500');
    expect(dot).toBeInTheDocument();
  });

  it('applies gray color to the dot when inactive', () => {
    const { container } = render(<AudioIndicator isActive={false} />);

    const dot = container.querySelector('.bg-gray-400');
    expect(dot).toBeInTheDocument();
  });

  it('applies red text color when active', () => {
    render(<AudioIndicator isActive={true} />);

    const label = screen.getByText('Recording');
    expect(label).toHaveClass('text-red-600');
  });

  it('applies gray text color when inactive', () => {
    render(<AudioIndicator isActive={false} />);

    const label = screen.getByText('Not recording');
    expect(label).toHaveClass('text-gray-500');
  });
});
