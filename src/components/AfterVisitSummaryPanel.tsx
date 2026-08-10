'use client';

export interface AfterVisitSummaryPanelProps {
  content: string | null;
  isLoading?: boolean;
  error?: string | null;
}

/**
 * AfterVisitSummaryPanel — Displays the patient-friendly after-visit summary
 * in a separate tab/panel from the clinical note. Renders content verbatim
 * as received from the Ambient Service.
 *
 * @see Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */
export function AfterVisitSummaryPanel({
  content,
  isLoading = false,
  error = null,
}: AfterVisitSummaryPanelProps) {
  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6"
        role="alert"
        aria-label="After-visit summary error"
      >
        <svg
          className="mb-3 h-8 w-8 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-center text-sm font-medium text-red-800">
          {error}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center p-6"
        role="status"
        aria-label="Loading after-visit summary"
      >
        <div
          className="mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"
          aria-hidden="true"
        />
        <p className="text-sm text-gray-500">
          Loading after-visit summary…
        </p>
      </div>
    );
  }

  if (!content) {
    return (
      <div
        className="flex h-full items-center justify-center p-6 text-gray-400"
        aria-label="After-visit summary"
      >
        <p>No after-visit summary available. Complete a session to generate a summary.</p>
      </div>
    );
  }

  return (
    <div
      className="overflow-y-auto p-4"
      aria-label="After-visit summary"
    >
      <h2 className="mb-3 text-lg font-semibold text-gray-800">
        After-Visit Summary
      </h2>
      <div
        className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700"
        data-testid="avs-content"
      >
        {content}
      </div>
    </div>
  );
}
