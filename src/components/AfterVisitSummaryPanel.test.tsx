/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AfterVisitSummaryPanel } from './AfterVisitSummaryPanel';

describe('AfterVisitSummaryPanel', () => {
  describe('content rendering', () => {
    it('renders content verbatim without modification', () => {
      const content = 'Your visit summary:\n- Blood pressure was normal\n- Continue current medications';
      render(<AfterVisitSummaryPanel content={content} />);

      const contentEl = screen.getByTestId('avs-content');
      expect(contentEl.textContent).toBe(content);
    });

    it('preserves whitespace formatting with whitespace-pre-wrap', () => {
      const content = 'Line 1\n  Indented line\n\nDouble spaced';
      const { container } = render(<AfterVisitSummaryPanel content={content} />);

      const contentEl = container.querySelector('[data-testid="avs-content"]');
      expect(contentEl).toHaveClass('whitespace-pre-wrap');
    });

    it('renders special characters without escaping or modification', () => {
      const content = 'Temperature: 98.6°F & blood pressure: 120/80 <normal>';
      render(<AfterVisitSummaryPanel content={content} />);

      const contentEl = screen.getByTestId('avs-content');
      expect(contentEl.textContent).toBe(content);
    });

    it('renders multi-line content preserving all newlines', () => {
      const content = 'Summary\n\nDiagnosis:\n- Condition A\n- Condition B\n\nFollow-up:\nReturn in 2 weeks';
      render(<AfterVisitSummaryPanel content={content} />);

      const contentEl = screen.getByTestId('avs-content');
      expect(contentEl.textContent).toBe(content);
    });

    it('renders empty string content as empty (not loading or placeholder)', () => {
      render(<AfterVisitSummaryPanel content="" />);

      // Empty string is falsy, so it shows the empty state
      expect(screen.queryByTestId('avs-content')).not.toBeInTheDocument();
    });

    it('displays the After-Visit Summary heading when content is present', () => {
      render(<AfterVisitSummaryPanel content="Some summary" />);

      expect(screen.getByText('After-Visit Summary')).toBeInTheDocument();
    });

    it('has accessible label on the content area', () => {
      render(<AfterVisitSummaryPanel content="Summary text" />);

      expect(screen.getByLabelText('After-visit summary')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(<AfterVisitSummaryPanel content={null} isLoading={true} />);

      expect(screen.getByRole('status', { name: /loading after-visit summary/i })).toBeInTheDocument();
    });

    it('displays loading text message', () => {
      render(<AfterVisitSummaryPanel content={null} isLoading={true} />);

      expect(screen.getByText(/loading after-visit summary/i)).toBeInTheDocument();
    });

    it('does not render content when loading', () => {
      render(<AfterVisitSummaryPanel content={null} isLoading={true} />);

      expect(screen.queryByTestId('avs-content')).not.toBeInTheDocument();
    });

    it('shows loading spinner animation element', () => {
      const { container } = render(<AfterVisitSummaryPanel content={null} isLoading={true} />);

      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('displays error message when error prop is provided', () => {
      const errorMsg = 'Failed to retrieve after-visit summary';
      render(<AfterVisitSummaryPanel content={null} error={errorMsg} />);

      expect(screen.getByText(errorMsg)).toBeInTheDocument();
    });

    it('renders error with alert role for accessibility', () => {
      render(<AfterVisitSummaryPanel content={null} error="Some error" />);

      expect(screen.getByRole('alert', { name: /after-visit summary error/i })).toBeInTheDocument();
    });

    it('does not render content when error is present', () => {
      render(<AfterVisitSummaryPanel content="Some content" error="Error occurred" />);

      expect(screen.queryByTestId('avs-content')).not.toBeInTheDocument();
    });

    it('prioritizes error over loading state', () => {
      render(<AfterVisitSummaryPanel content={null} isLoading={true} error="Error" />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows placeholder message when content is null and not loading', () => {
      render(<AfterVisitSummaryPanel content={null} />);

      expect(screen.getByText(/no after-visit summary available/i)).toBeInTheDocument();
    });

    it('does not show loading indicator when content is null and isLoading is false', () => {
      render(<AfterVisitSummaryPanel content={null} isLoading={false} />);

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('verbatim rendering property', () => {
    it('does not trim leading or trailing whitespace from content', () => {
      const content = '  leading spaces and trailing spaces  ';
      render(<AfterVisitSummaryPanel content={content} />);

      const contentEl = screen.getByTestId('avs-content');
      expect(contentEl.textContent).toBe(content);
    });

    it('preserves tab characters in content', () => {
      const content = 'Item:\t\tValue\nOther:\t\tData';
      render(<AfterVisitSummaryPanel content={content} />);

      const contentEl = screen.getByTestId('avs-content');
      expect(contentEl.textContent).toBe(content);
    });

    it('preserves unicode characters in content', () => {
      const content = 'Patient: José García\nNotes: ñ, ü, é, 中文, 日本語';
      render(<AfterVisitSummaryPanel content={content} />);

      const contentEl = screen.getByTestId('avs-content');
      expect(contentEl.textContent).toBe(content);
    });
  });
});
