'use client';

import { useState, useCallback } from 'react';
import { SessionProvider, useSession } from '@/lib/session-context';
import { PatientSelector, Patient } from '@/components/PatientSelector';
import { PatientContextPanel } from '@/components/PatientContextPanel';
import { SessionControls } from '@/components/SessionControls';
import { AudioIndicator } from '@/components/AudioIndicator';
import { TranscriptView } from '@/components/TranscriptView';
import { ClinicalNotePanel } from '@/components/ClinicalNotePanel';
import { AfterVisitSummaryPanel } from '@/components/AfterVisitSummaryPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { EvidenceMapping } from '@/types';

// ─── Tab Types ───────────────────────────────────────────────────────────────

type OutputTab = 'clinical-note' | 'after-visit-summary';

// ─── Main Page Content (inside SessionProvider) ──────────────────────────────

function AmbientDocumentationContent() {
  const { state } = useSession();
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientContext, setPatientContext] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OutputTab>('clinical-note');
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);

  const session = state.session;
  const isSessionActive = session?.status === 'active';

  const handlePatientSelect = useCallback((patient: Patient) => {
    setSelectedPatient(patient);
    setPatientContext(null);
    setHighlightedSegmentId(null);
  }, []);

  const handleContextReady = useCallback((context: string) => {
    setPatientContext(context);
  }, []);

  const handleContextError = useCallback(() => {
    setPatientContext(null);
  }, []);

  const handleEvidenceClick = useCallback((evidence: EvidenceMapping) => {
    if (evidence.sourceType === 'transcript' && evidence.transcriptReference) {
      // Find the segment that matches the time range
      const matchingSegment = state.transcriptSegments.find(
        (seg) =>
          seg.startTime >= (evidence.transcriptReference?.startTime ?? 0) &&
          seg.startTime <= (evidence.transcriptReference?.endTime ?? 0)
      );
      if (matchingSegment) {
        setHighlightedSegmentId(matchingSegment.id);
      }
    }
  }, [state.transcriptSegments]);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              Ambient Clinical Documentation
            </h1>
            <p className="text-sm text-gray-500">
              Amazon Connect Health + OpenEMR Demo
            </p>
          </div>
          {isSessionActive && (
            <AudioIndicator isActive={true} source="microphone" />
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Patient Selection & Context */}
        <aside className="flex w-80 flex-shrink-0 flex-col border-r border-gray-200 bg-gray-50">
          <div className="flex-shrink-0 border-b border-gray-200 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Patient
            </h2>
            <PatientSelector
              onSelect={handlePatientSelect}
              selectedPatientId={selectedPatient?.id}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <PatientContextPanel
              patientId={selectedPatient?.id ?? null}
              onContextReady={handleContextReady}
              onContextError={handleContextError}
            />
          </div>
        </aside>

        {/* Center Panel — Session Controls & Transcript */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Session Controls */}
          <div className="flex-shrink-0 border-b border-gray-200 p-4">
            <SessionControls
              patientId={selectedPatient?.id ?? null}
              patientContext={patientContext}
            />
          </div>

          {/* Transcript View */}
          <div className="flex-1 overflow-y-auto bg-white">
            <TranscriptView
              segments={state.transcriptSegments}
              highlightedSegmentId={highlightedSegmentId}
            />
          </div>
        </main>

        {/* Right Panel — Clinical Note / After-Visit Summary (Tabbed) */}
        <aside className="flex w-96 flex-shrink-0 flex-col border-l border-gray-200 bg-white">
          {/* Tab Navigation */}
          <div className="flex-shrink-0 border-b border-gray-200" role="tablist" aria-label="Output panels">
            <div className="flex">
              <button
                role="tab"
                aria-selected={activeTab === 'clinical-note'}
                aria-controls="panel-clinical-note"
                id="tab-clinical-note"
                onClick={() => setActiveTab('clinical-note')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'clinical-note'
                    ? 'border-b-2 border-blue-600 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Clinical Note
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'after-visit-summary'}
                aria-controls="panel-after-visit-summary"
                id="tab-after-visit-summary"
                onClick={() => setActiveTab('after-visit-summary')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'after-visit-summary'
                    ? 'border-b-2 border-blue-600 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                After-Visit Summary
              </button>
            </div>
          </div>

          {/* Tab Panels */}
          <div className="flex-1 overflow-y-auto">
            <div
              id="panel-clinical-note"
              role="tabpanel"
              aria-labelledby="tab-clinical-note"
              hidden={activeTab !== 'clinical-note'}
              className="h-full"
            >
              <ClinicalNotePanel
                clinicalNote={state.clinicalNote}
                isLoading={session?.status === 'ending'}
                onEvidenceClick={handleEvidenceClick}
              />
            </div>
            <div
              id="panel-after-visit-summary"
              role="tabpanel"
              aria-labelledby="tab-after-visit-summary"
              hidden={activeTab !== 'after-visit-summary'}
              className="h-full"
            >
              <AfterVisitSummaryPanel
                content={state.afterVisitSummary}
                isLoading={session?.status === 'ending'}
                error={
                  session?.status === 'ended' && !state.afterVisitSummary && !state.isLoading
                    ? undefined
                    : undefined
                }
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function Home() {
  return (
    <SessionProvider>
      <ErrorBoundary>
        <AmbientDocumentationContent />
      </ErrorBoundary>
    </SessionProvider>
  );
}
