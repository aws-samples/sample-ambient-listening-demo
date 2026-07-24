'use client';

/**
 * ClinicalNotePanel — Displays and allows editing of AI-generated clinical notes.
 *
 * RESPONSIBLE AI: AI-generated clinical notes are assistive outputs only. They must be
 * reviewed, edited, and approved by a licensed clinician before being written to the
 * patient's medical record. The editable UI enforces human-in-the-loop validation.
 * AI outputs should not be used as the sole basis for clinical decisions.
 * For production deployments, enable Amazon Bedrock Guardrails for content filtering
 * and configure output validation to detect hallucinated or inappropriate content.
 *
 * HIPAA NOTICE: This component displays Protected Health Information (PHI) including
 * clinical notes, SOAP sections, and evidence mappings. Ensure the application
 * implements HIPAA-required controls including encryption, access controls, and
 * audit logging for production deployments.
 */

import { useState, useEffect, useCallback } from 'react';
import { ClinicalNote, EvidenceMapping, SOAPSection } from '../types';
import { ConfirmationDialog } from './ConfirmationDialog';

type SubmissionStatus = 'idle' | 'submitting' | 'success' | 'error';

interface SubmissionState {
  status: SubmissionStatus;
  encounterId?: number;
  error?: string;
}

export interface ClinicalNotePanelProps {
  clinicalNote: ClinicalNote | null;
  isLoading?: boolean;
  onEvidenceClick?: (evidence: EvidenceMapping) => void;
  patientId?: string | null;
  patientName?: string | null;
  sessionEnded?: boolean;
  onNewSession?: () => void;
}

/**
 * ClinicalNotePanel — Displays the clinical note in SOAP format with section headings
 * (Subjective, Objective, Assessment, Plan). When the session has ended and a note is
 * available, renders editable textareas for each section and a "Submit to EMR" button
 * that triggers a confirmation dialog before posting to the writeback API.
 *
 * @see Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.2, 3.3, 5.1, 5.2, 5.3, 5.4, 5.5
 */
export function ClinicalNotePanel({
  clinicalNote,
  isLoading = false,
  onEvidenceClick,
  patientId = null,
  patientName = null,
  sessionEnded = false,
  onNewSession,
}: ClinicalNotePanelProps) {
  const [editedSections, setEditedSections] = useState<Record<string, string>>({});
  const [submissionState, setSubmissionState] = useState<SubmissionState>({ status: 'idle' });
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Initialize editedSections when clinicalNote becomes available
  useEffect(() => {
    if (clinicalNote) {
      const initial: Record<string, string> = {};
      for (const section of clinicalNote.sections) {
        initial[section.heading] = section.content;
      }
      setEditedSections(initial);
    }
  }, [clinicalNote]);

  const isEditingEnabled = sessionEnded && !!clinicalNote && submissionState.status !== 'success';
  const isSubmitEnabled =
    isEditingEnabled &&
    submissionState.status !== 'submitting' &&
    submissionState.status !== 'success';

  const handleSectionChange = useCallback((heading: string, content: string) => {
    setEditedSections((prev) => ({ ...prev, [heading]: content }));
  }, []);

  const handleSubmitClick = () => {
    setShowConfirmDialog(true);
  };

  const handleConfirm = async () => {
    setShowConfirmDialog(false);
    setSubmissionState({ status: 'submitting' });

    try {
      const sections = clinicalNote!.sections.map((s) => ({
        heading: s.heading,
        content: editedSections[s.heading] ?? s.content,
      }));

      const response = await fetch('/api/encounters/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, sections }),
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Submission failed' }));
        setSubmissionState({ status: 'error', error: data.error || 'Submission failed' });
        return;
      }

      const data = await response.json();
      setSubmissionState({ status: 'success', encounterId: data.encounterId });
    } catch (err) {
      setSubmissionState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Network error. Please try again.',
      });
    }
  };

  const handleCancel = () => {
    setShowConfirmDialog(false);
  };

  const handleRetry = () => {
    handleConfirm();
  };

  if (isLoading || !clinicalNote) {
    return (
      <div
        className="flex h-full items-center justify-center p-4"
        role="region"
        aria-label="Clinical Note"
      >
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"
            role="status"
            aria-label="Loading clinical note"
          />
          <p className="text-sm text-gray-500">
            {isLoading ? 'Generating clinical note...' : 'No clinical note available.'}
          </p>
        </div>
      </div>
    );
  }

  // Group evidence mappings by section
  const evidenceBySection = groupEvidenceBySection(
    clinicalNote.sections,
    clinicalNote.evidenceMap
  );

  return (
    <div
      className="flex flex-col gap-6 overflow-y-auto p-4"
      role="region"
      aria-label="Clinical Note"
    >
      {clinicalNote.sections.map((section) =>
        isEditingEnabled ? (
          <SOAPSectionEditor
            key={section.heading}
            section={section}
            editedContent={editedSections[section.heading] ?? section.content}
            onChange={(content) => handleSectionChange(section.heading, content)}
            disabled={submissionState.status === 'success'}
          />
        ) : (
          <SOAPSectionDisplay
            key={section.heading}
            section={section}
            evidenceEntries={evidenceBySection[section.heading] || []}
            onEvidenceClick={onEvidenceClick}
          />
        )
      )}

      {/* Render any unmatched evidence entries at the bottom (read-only mode only) */}
      {!isEditingEnabled &&
        evidenceBySection['_unmatched'] &&
        evidenceBySection['_unmatched'].length > 0 && (
          <div className="border-t border-gray-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-600">
              Evidence References
            </h3>
            <EvidenceList
              entries={evidenceBySection['_unmatched']}
              onEvidenceClick={onEvidenceClick}
            />
          </div>
        )}

      {/* Submission Status Indicator */}
      {submissionState.status === 'submitting' && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          <p className="text-sm text-blue-700">Submitting to EMR...</p>
        </div>
      )}

      {submissionState.status === 'success' && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm text-green-700">
            ✓ Successfully submitted. Encounter ID:{' '}
            <span className="font-medium">{submissionState.encounterId}</span>
          </p>
          {onNewSession && (
            <button
              type="button"
              onClick={onNewSession}
              className="mt-2 w-full rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 transition-colors"
            >
              Start New Session
            </button>
          )}
        </div>
      )}

      {submissionState.status === 'error' && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">
            {submissionState.error || 'Submission failed'}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-lg border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Submit to EMR Button */}
      {sessionEnded && clinicalNote && (
        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={!isSubmitEnabled}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          Submit to EMR
        </button>
      )}

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showConfirmDialog}
        patientName={patientName || 'Unknown Patient'}
        sectionCount={clinicalNote.sections.length}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}

// ─── SOAPSectionEditor ───────────────────────────────────────────────────────

interface SOAPSectionEditorProps {
  section: SOAPSection;
  editedContent: string;
  onChange: (content: string) => void;
  disabled: boolean;
}

function SOAPSectionEditor({
  section,
  editedContent,
  onChange,
  disabled,
}: SOAPSectionEditorProps) {
  const headingStyles = getSectionHeadingStyles(section.heading);

  return (
    <div data-testid={`soap-section-${section.heading.toLowerCase()}`}>
      <h3
        className={`mb-2 text-sm font-semibold uppercase tracking-wide ${headingStyles}`}
      >
        {section.heading}
      </h3>
      <div className="rounded-lg border border-blue-300 border-l-4 border-l-blue-500 bg-white p-1">
        <textarea
          value={editedContent}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={`Edit ${section.heading} section`}
          className="w-full resize-y rounded-md border-0 bg-transparent p-2 text-sm text-gray-800 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
          rows={Math.max(4, editedContent.split('\n').length + 1)}
        />
      </div>
    </div>
  );
}

// ─── SOAPSectionDisplay (read-only) ──────────────────────────────────────────

interface SOAPSectionDisplayProps {
  section: SOAPSection;
  evidenceEntries: EvidenceMapping[];
  onEvidenceClick?: (evidence: EvidenceMapping) => void;
}

function SOAPSectionDisplay({
  section,
  evidenceEntries,
  onEvidenceClick,
}: SOAPSectionDisplayProps) {
  const headingStyles = getSectionHeadingStyles(section.heading);

  return (
    <div data-testid={`soap-section-${section.heading.toLowerCase()}`}>
      <h3
        className={`mb-2 text-sm font-semibold uppercase tracking-wide ${headingStyles}`}
      >
        {section.heading}
      </h3>
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="whitespace-pre-wrap text-sm text-gray-800">{section.content}</p>
        {evidenceEntries.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-2">
            <EvidenceList entries={evidenceEntries} onEvidenceClick={onEvidenceClick} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Evidence Components ─────────────────────────────────────────────────────

interface EvidenceListProps {
  entries: EvidenceMapping[];
  onEvidenceClick?: (evidence: EvidenceMapping) => void;
}

function EvidenceList({ entries, onEvidenceClick }: EvidenceListProps) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Evidence references">
      {entries.map((entry) => (
        <li key={entry.noteStatementId}>
          <EvidenceLink entry={entry} onClick={onEvidenceClick} />
        </li>
      ))}
    </ul>
  );
}

interface EvidenceLinkProps {
  entry: EvidenceMapping;
  onClick?: (evidence: EvidenceMapping) => void;
}

function EvidenceLink({ entry, onClick }: EvidenceLinkProps) {
  const isClickable = onClick && entry.sourceType === 'transcript' && entry.transcriptReference;

  const sourceLabel =
    entry.sourceType === 'transcript' ? 'Transcript' : 'Patient Context';

  const timeLabel = entry.transcriptReference
    ? formatTimeRange(entry.transcriptReference.startTime, entry.transcriptReference.endTime)
    : null;

  if (isClickable) {
    return (
      <button
        className="group flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-blue-50"
        onClick={() => onClick(entry)}
        aria-label={`View evidence: ${entry.noteStatement}`}
        data-testid={`evidence-link-${entry.noteStatementId}`}
      >
        <span className="mt-0.5 shrink-0 text-blue-500">🔗</span>
        <span className="flex-1">
          <span className="text-blue-700 group-hover:underline">
            {entry.noteStatement}
          </span>
          {timeLabel && (
            <span className="ml-2 text-gray-400">({timeLabel})</span>
          )}
        </span>
        <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
          {sourceLabel}
        </span>
      </button>
    );
  }

  return (
    <div
      className="flex items-start gap-2 rounded px-2 py-1 text-xs"
      data-testid={`evidence-link-${entry.noteStatementId}`}
    >
      <span className="mt-0.5 shrink-0 text-gray-400">📋</span>
      <span className="flex-1 text-gray-600">{entry.noteStatement}</span>
      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
        {sourceLabel}
      </span>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSectionHeadingStyles(heading: SOAPSection['heading']): string {
  switch (heading) {
    case 'Subjective':
      return 'text-purple-700';
    case 'Objective':
      return 'text-blue-700';
    case 'Assessment':
      return 'text-amber-700';
    case 'Plan':
      return 'text-green-700';
    default:
      return 'text-gray-700';
  }
}

function formatTimeRange(startTime: number, endTime: number): string {
  return `${formatTime(startTime)} – ${formatTime(endTime)}`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Groups evidence mappings by SOAP section. An evidence entry is matched to a section
 * if the note statement text appears within the section content. Unmatched entries
 * are placed in the '_unmatched' group.
 */
function groupEvidenceBySection(
  sections: SOAPSection[],
  evidenceMap: EvidenceMapping[]
): Record<string, EvidenceMapping[]> {
  const result: Record<string, EvidenceMapping[]> = {};

  for (const section of sections) {
    result[section.heading] = [];
  }
  result['_unmatched'] = [];

  for (const evidence of evidenceMap) {
    let matched = false;
    for (const section of sections) {
      if (section.content.includes(evidence.noteStatement)) {
        (result[section.heading] ?? []).push(evidence);
        matched = true;
        break;
      }
    }
    if (!matched) {
      result['_unmatched'].push(evidence);
    }
  }

  return result;
}
