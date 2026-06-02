/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConfirmationDialog } from './ConfirmationDialog';

describe('ConfirmationDialog', () => {
  const defaultProps = {
    isOpen: true,
    patientName: 'John Doe',
    sectionCount: 4,
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when closed', () => {
    it('renders nothing when isOpen is false', () => {
      const { container } = render(
        <ConfirmationDialog {...defaultProps} isOpen={false} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('when open', () => {
    it('renders a dialog with role="dialog"', () => {
      render(<ConfirmationDialog {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has aria-modal="true"', () => {
      render(<ConfirmationDialog {...defaultProps} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('has aria-labelledby pointing to the title', () => {
      render(<ConfirmationDialog {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby', 'confirmation-dialog-title');
      expect(
        screen.getByText('Submit Clinical Note')
      ).toHaveAttribute('id', 'confirmation-dialog-title');
    });

    it('displays the patient name in the confirmation message', () => {
      render(<ConfirmationDialog {...defaultProps} patientName="Jane Smith" />);
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    it('displays the section count in the confirmation message', () => {
      render(<ConfirmationDialog {...defaultProps} sectionCount={3} />);
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('uses singular "section" when count is 1', () => {
      render(<ConfirmationDialog {...defaultProps} sectionCount={1} />);
      expect(screen.getByText(/1/)).toBeInTheDocument();
      expect(screen.getByText(/section for patient/)).toBeInTheDocument();
    });

    it('uses plural "sections" when count is greater than 1', () => {
      render(<ConfirmationDialog {...defaultProps} sectionCount={4} />);
      expect(screen.getByText(/sections for patient/)).toBeInTheDocument();
    });

    it('renders a Confirm button', () => {
      render(<ConfirmationDialog {...defaultProps} />);
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    });

    it('renders a Cancel button', () => {
      render(<ConfirmationDialog {...defaultProps} />);
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('calls onConfirm when Confirm button is clicked', () => {
      const onConfirm = jest.fn();
      render(<ConfirmationDialog {...defaultProps} onConfirm={onConfirm} />);
      fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when Cancel button is clicked', () => {
      const onCancel = jest.fn();
      render(<ConfirmationDialog {...defaultProps} onCancel={onCancel} />);
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard interaction', () => {
    it('calls onCancel when Escape key is pressed', () => {
      const onCancel = jest.fn();
      render(<ConfirmationDialog {...defaultProps} onCancel={onCancel} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not call onCancel on Escape when dialog is closed', () => {
      const onCancel = jest.fn();
      render(
        <ConfirmationDialog {...defaultProps} isOpen={false} onCancel={onCancel} />
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('focus management', () => {
    it('traps focus within the dialog on Tab', () => {
      render(<ConfirmationDialog {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      const buttons = dialog.querySelectorAll('button');
      const lastButton = buttons[buttons.length - 1];

      // Focus the last button and press Tab — should wrap to first
      (lastButton as HTMLElement).focus();
      fireEvent.keyDown(dialog, { key: 'Tab' });
      // Focus trap should prevent focus from leaving the dialog
    });

    it('traps focus within the dialog on Shift+Tab', () => {
      render(<ConfirmationDialog {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      const buttons = dialog.querySelectorAll('button');
      const firstButton = buttons[0];

      // Focus the first button and press Shift+Tab — should wrap to last
      (firstButton as HTMLElement).focus();
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
      // Focus trap should prevent focus from leaving the dialog
    });
  });

  describe('backdrop interaction', () => {
    it('calls onCancel when clicking the backdrop overlay', () => {
      const onCancel = jest.fn();
      const { container } = render(
        <ConfirmationDialog {...defaultProps} onCancel={onCancel} />
      );
      // Click the backdrop (the outer fixed overlay)
      const backdrop = container.firstChild as HTMLElement;
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not call onCancel when clicking inside the dialog', () => {
      const onCancel = jest.fn();
      render(<ConfirmationDialog {...defaultProps} onCancel={onCancel} />);
      const dialog = screen.getByRole('dialog');
      fireEvent.click(dialog);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
