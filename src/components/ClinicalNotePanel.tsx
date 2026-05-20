'use client';

import { ClinicalNote, EvidenceMapping, SOAPSection } from '../types';

export interface ClinicalNotePanelProps {
  clinicalNote: ClinicalNote | null;
  isLoading?: boolean;
  onEvidenceClick?: (evidence: EvidenceMapping) => void;
}

/**
 * ClinicalNotePanel — Displays the clinical note in SOAP format with section headings
 * (Subjective, Objective, Assessment, Plan) and renders evidence map entries as
 * clickable links that scroll the transcript to the corresponding moment.
 *
 * @see Requirements 7.2, 7.3, 7.4
 */
export function ClinicalNotePanel({
  clinicalNote,
  isLoading = false,
  onEvidenceClick,
}: ClinicalNotePanelProps) {
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

  // Group evidence mappings by section — match evidence to sections by checking
  // if the note statement appears in the section content
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
      {clinicalNote.sections.map((section) => (
        <SOAPSectionDisplay
          key={section.heading}
          section={section}
          evidenceEntries={evidenceBySection[section.heading] || []}
          onEvidenceClick={onEvidenceClick}
        />
      ))}

      {/* Render any unmatched evidence entries at the bottom */}
      {evidenceBySection['_unmatched'] && evidenceBySection['_unmatched'].length > 0 && (
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
    </div>
  );
}

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
