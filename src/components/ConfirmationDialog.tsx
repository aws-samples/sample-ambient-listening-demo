'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface ConfirmationDialogProps {
  isOpen: boolean;
  patientName: string;
  sectionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * ConfirmationDialog — A modal dialog that requires explicit provider approval
 * before submitting the clinical note to OpenEMR. Displays the patient name and
 * section count, traps focus within the dialog, and supports Escape key to cancel.
 *
 * @see Requirements 3.1, 3.4
 */
export function ConfirmationDialog({
  isOpen,
  patientName,
  sectionCount,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button when the dialog opens
  useEffect(() => {
    if (isOpen) {
      confirmButtonRef.current?.focus();
    }
  }, [isOpen]);

  // Handle Escape key to cancel
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  // Trap focus within the dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement | undefined;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement | undefined;

      if (e.shiftKey) {
        if (document.activeElement === firstElement && lastElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement && firstElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    },
    []
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        className="mx-4 w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2
          id="confirmation-dialog-title"
          className="text-lg font-semibold text-gray-900"
        >
          Submit Clinical Note
        </h2>

        <p className="mt-3 text-sm text-gray-600">
          You are about to submit a clinical note with{' '}
          <span className="font-medium text-gray-900">{sectionCount}</span>{' '}
          {sectionCount === 1 ? 'section' : 'sections'} for patient{' '}
          <span className="font-medium text-gray-900">{patientName}</span> to
          OpenEMR. This will create a new encounter record.
        </p>

        <p className="mt-2 text-sm text-gray-500">
          Are you sure you want to proceed?
        </p>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
