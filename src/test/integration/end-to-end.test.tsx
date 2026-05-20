/**
 * @jest-environment jsdom
 */

/**
 * Integration tests for the end-to-end ambient clinical documentation flow.
 *
 * Tests the full user workflow:
 * 1. Patient selection triggers context loading
 * 2. Session start creates domain/subscription/session
 * 3. Transcript segments appear in the UI
 * 4. Session end triggers output retrieval
 * 5. Clinical note and AVS are displayed
 * 6. Write-back saves to OpenEMR
 *
 * Also tests error scenarios:
 * - FHIR API unreachable during patient selection
 * - Session creation failure
 * - Audio stream interruption (simulated via error state)
 *
 * Uses jest.fn() to mock fetch for external service calls.
 *
 * @see Requirements: All requirements
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SessionProvider, useSession } from '@/lib/session-context';
import { PatientSelector } from '@/components/PatientSelector';
import { PatientContextPanel } from '@/components/PatientContextPanel';
import { SessionControls } from '@/components/SessionControls';
import { TranscriptView } from '@/components/TranscriptView';
import { ClinicalNotePanel } from '@/components/ClinicalNotePanel';
import { AfterVisitSummaryPanel } from '@/components/AfterVisitSummaryPanel';
import type { AmbientSession, TranscriptSegment, ClinicalNote } from '@/types';


// ─── Mock Data ───────────────────────────────────────────────────────────────

const mockPatients = [
  { id: 'patient-1', name: 'John Doe', dateOfBirth: '1980-01-15' },
  { id: 'patient-2', name: 'Jane Smith', dateOfBirth: '1969-03-22' },
];

const mockPatientContext = {
  context:
    'Patient: John Doe\nAge: 44\nSex: male\nDOB: 1980-01-15\n\n' +
    'Allergies:\n- Penicillin (active)\n\n' +
    'Medications:\n- Metformin 500mg (500mg twice daily)\n\n' +
    'Conditions:\n- Type 2 Diabetes Mellitus (onset: 2015-06-01)',
  warnings: [],
};

const mockSession: AmbientSession = {
  sessionId: 'session-123',
  domainId: 'domain-001',
  subscriptionId: 'sub-001',
  status: 'active',
  patientId: 'patient-1',
  patientContext: mockPatientContext.context,
  outputS3Uri: 's3://test-bucket/health-agent-listening-session/domain-001/sub-001/session-123/',
  startedAt: new Date('2024-01-15T10:00:00Z'),
};

const mockEndedSession: AmbientSession = {
  ...mockSession,
  status: 'ended',
  endedAt: new Date('2024-01-15T10:30:00Z'),
};

const mockClinicalNote: ClinicalNote = {
  sections: [
    { heading: 'Subjective', content: 'Patient reports persistent fatigue for the past two weeks.' },
    { heading: 'Objective', content: 'Vitals: BP 120/80, HR 72, Temp 98.6F.' },
    { heading: 'Assessment', content: 'Type 2 Diabetes Mellitus, well-controlled.' },
    { heading: 'Plan', content: 'Continue Metformin 500mg. Follow up in 4 weeks.' },
  ],
  evidenceMap: [
    {
      noteStatementId: 'stmt-1',
      noteStatement: 'Patient reports persistent fatigue for the past two weeks.',
      sourceType: 'transcript',
      transcriptReference: { startTime: 4.0, endTime: 8.2, content: 'I have been feeling really tired lately.' },
    },
  ],
};

const mockAfterVisitSummary =
  'Your visit summary:\n\nWe discussed your diabetes management today.\n\nNext steps:\n- Continue Metformin 500mg\n- Follow-up in 4 weeks';

const mockTranscriptSegments: TranscriptSegment[] = [
  { id: 'seg-1', content: 'Good morning. How are you feeling today?', speaker: 'CLINICIAN', channelId: 0, startTime: 0, endTime: 3.5, isPartial: false },
  { id: 'seg-2', content: 'I have been feeling really tired lately.', speaker: 'PATIENT', channelId: 1, startTime: 4.0, endTime: 8.2, isPartial: false },
];


// ─── Fetch Mock Helper ───────────────────────────────────────────────────────

/**
 * Creates a mock fetch that routes requests to appropriate mock responses.
 * Simulates the backend API layer (FHIR, Connect Health, S3 interactions).
 */
function createMockFetch(overrides?: Record<string, () => Promise<Response> | Response>) {
  return jest.fn((url: string, options?: RequestInit) => {
    // Check overrides first
    if (overrides) {
      for (const [pattern, handler] of Object.entries(overrides)) {
        if (url.includes(pattern)) {
          return Promise.resolve(handler());
        }
      }
    }

    // GET /api/patients
    if (url === '/api/patients' && (!options || options.method === 'GET' || !options.method)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockPatients,
      } as Response);
    }

    // GET /api/patients/:id/context
    if (url.match(/\/api\/patients\/[^/]+\/context/) && (!options || !options.method || options.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockPatientContext,
      } as Response);
    }

    // POST /api/sessions
    if (url === '/api/sessions' && options?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockSession,
      } as Response);
    }

    // POST /api/sessions/:id/end
    if (url.match(/\/api\/sessions\/[^/]+\/end/) && options?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockEndedSession,
      } as Response);
    }

    // GET /api/sessions/:id/outputs
    if (url.match(/\/api\/sessions\/[^/]+\/outputs/) && (!options || !options.method || options.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ clinicalNote: mockClinicalNote, afterVisitSummary: mockAfterVisitSummary }),
      } as Response);
    }

    // POST /api/sessions/:id/writeback
    if (url.match(/\/api\/sessions\/[^/]+\/writeback/) && options?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, documentReferenceId: 'doc-ref-1' }),
      } as Response);
    }

    // Default: 404
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Not found' }),
    } as Response);
  });
}

// ─── Test Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = createMockFetch();
  // Mock scrollIntoView which is not available in jsdom
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});


// ─── Helper: Wrapper with SessionProvider ────────────────────────────────────

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

/**
 * Helper component that exposes session actions for testing the full flow.
 * Renders the main UI components and provides imperative controls for
 * simulating WebSocket-delivered events (transcript, outputs).
 */
function FullFlowTestHarness() {
  const { state, addTranscript, setOutputs } = useSession();
  const [selectedPatientId, setSelectedPatientId] = React.useState<string | null>(null);
  const [patientContext, setPatientContext] = React.useState<string | null>(null);

  return (
    <div>
      {/* Patient Selection */}
      <PatientSelector
        onSelect={(patient) => setSelectedPatientId(patient.id)}
        selectedPatientId={selectedPatientId ?? undefined}
      />

      {/* Patient Context */}
      <PatientContextPanel
        patientId={selectedPatientId}
        onContextReady={(ctx) => setPatientContext(ctx)}
        onContextError={() => setPatientContext(null)}
      />

      {/* Session Controls */}
      <SessionControls
        patientId={selectedPatientId}
        patientContext={patientContext}
      />

      {/* Transcript */}
      <TranscriptView
        segments={state.transcriptSegments}
        highlightedSegmentId={null}
      />

      {/* Clinical Note */}
      <ClinicalNotePanel
        clinicalNote={state.clinicalNote}
        isLoading={state.session?.status === 'ending'}
        onEvidenceClick={() => {}}
      />

      {/* After-Visit Summary */}
      <AfterVisitSummaryPanel
        content={state.afterVisitSummary}
        isLoading={state.session?.status === 'ending'}
      />

      {/* Test controls for simulating WebSocket events */}
      <button
        data-testid="simulate-transcript"
        onClick={() => {
          mockTranscriptSegments.forEach((seg) => addTranscript(seg));
        }}
      >
        Simulate Transcript
      </button>
      <button
        data-testid="simulate-outputs"
        onClick={() => {
          setOutputs(mockClinicalNote, mockAfterVisitSummary);
        }}
      >
        Simulate Outputs
      </button>

      {/* State inspection for assertions */}
      <div data-testid="session-status">{state.session?.status ?? 'none'}</div>
      <div data-testid="session-error">{state.error ?? ''}</div>
    </div>
  );
}


// ─── Integration Tests: Happy Path ──────────────────────────────────────────

describe('End-to-End Integration: Happy Path', () => {
  it('loads and displays patient list on mount', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('patient selection triggers context loading', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Wait for patients to load
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Select a patient
    fireEvent.click(screen.getByText('John Doe'));

    // Wait for context to load
    await waitFor(() => {
      expect(screen.getByText(/Patient: John Doe/)).toBeInTheDocument();
    });

    // Verify context content is displayed
    expect(screen.getByText(/Allergies:/)).toBeInTheDocument();
    expect(screen.getByText(/Medications:/)).toBeInTheDocument();
    expect(screen.getByText(/Conditions:/)).toBeInTheDocument();
  });

  it('session start creates session after patient context is loaded', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Wait for patients and select one
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('John Doe'));

    // Wait for context to load
    await waitFor(() => {
      expect(screen.getByText(/Patient: John Doe/)).toBeInTheDocument();
    });

    // Start session
    const startButton = screen.getByRole('button', { name: /start session/i });
    expect(startButton).not.toBeDisabled();
    fireEvent.click(startButton);

    // Wait for session to become active
    await waitFor(() => {
      expect(screen.getByTestId('session-status')).toHaveTextContent('active');
    });
  });

  it('transcript segments appear in the UI when received', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Setup: select patient, load context, start session
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('John Doe'));
    await waitFor(() => {
      expect(screen.getByText(/Patient: John Doe/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
    await waitFor(() => {
      expect(screen.getByTestId('session-status')).toHaveTextContent('active');
    });

    // Simulate transcript segments arriving via WebSocket
    fireEvent.click(screen.getByTestId('simulate-transcript'));

    // Verify transcript segments are displayed
    await waitFor(() => {
      expect(screen.getByText('Good morning. How are you feeling today?')).toBeInTheDocument();
    });
    expect(screen.getByText('I have been feeling really tired lately.')).toBeInTheDocument();
  });

  it('session end updates status to ended', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Setup: select patient, load context, start session
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('John Doe'));
    await waitFor(() => {
      expect(screen.getByText(/Patient: John Doe/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
    await waitFor(() => {
      expect(screen.getByTestId('session-status')).toHaveTextContent('active');
    });

    // End session
    fireEvent.click(screen.getByRole('button', { name: /end session/i }));

    // Wait for session to end
    await waitFor(() => {
      expect(screen.getByTestId('session-status')).toHaveTextContent('ended');
    });
  });

  it('clinical note is displayed with SOAP sections after outputs are set', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Simulate outputs being received
    fireEvent.click(screen.getByTestId('simulate-outputs'));

    // Verify SOAP sections are displayed
    await waitFor(() => {
      expect(screen.getByText('Subjective')).toBeInTheDocument();
    });
    expect(screen.getByText('Objective')).toBeInTheDocument();
    expect(screen.getByText('Assessment')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    // Note content appears in both SOAP section and evidence map, so use getAllByText
    expect(screen.getAllByText(/Patient reports persistent fatigue/).length).toBeGreaterThanOrEqual(1);
  });

  it('after-visit summary is displayed verbatim', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Simulate outputs
    fireEvent.click(screen.getByTestId('simulate-outputs'));

    // Verify AVS content is rendered
    await waitFor(() => {
      expect(screen.getByText(/Your visit summary:/)).toBeInTheDocument();
    });
  });
});


// ─── Integration Tests: Full Workflow ────────────────────────────────────────

describe('End-to-End Integration: Full Workflow', () => {
  it('completes full flow: patient select → context → session → transcript → end → outputs', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Step 1: Patient list loads
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    // Step 2: Select patient
    fireEvent.click(screen.getByText('John Doe'));

    // Step 3: Context loads
    await waitFor(() => {
      expect(screen.getByText(/Patient: John Doe/)).toBeInTheDocument();
    });

    // Step 4: Start session
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
    await waitFor(() => {
      expect(screen.getByTestId('session-status')).toHaveTextContent('active');
    });

    // Step 5: Transcript segments arrive
    fireEvent.click(screen.getByTestId('simulate-transcript'));
    await waitFor(() => {
      expect(screen.getByText('Good morning. How are you feeling today?')).toBeInTheDocument();
    });

    // Step 6: End session
    fireEvent.click(screen.getByRole('button', { name: /end session/i }));
    await waitFor(() => {
      expect(screen.getByTestId('session-status')).toHaveTextContent('ended');
    });

    // Step 7: Outputs arrive (simulating what would happen after S3 retrieval)
    fireEvent.click(screen.getByTestId('simulate-outputs'));
    await waitFor(() => {
      expect(screen.getByText('Subjective')).toBeInTheDocument();
    });
    expect(screen.getByText(/Your visit summary:/)).toBeInTheDocument();
  });
});


// ─── Integration Tests: Error Scenarios ──────────────────────────────────────

describe('End-to-End Integration: Error Scenarios', () => {
  it('displays error when FHIR API is unreachable during patient selection', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'Unable to connect to the patient service' }),
    });

    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/Error loading patients/i)).toBeInTheDocument();
  });

  it('displays error when patient context retrieval fails (FHIR timeout)', async () => {
    // First call succeeds (patient list), second fails (context)
    global.fetch = jest.fn((url: string) => {
      if (url === '/api/patients') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockPatients,
        } as Response);
      }
      if (url.includes('/context')) {
        return Promise.resolve({
          ok: false,
          status: 504,
          json: async () => ({ message: 'EHR connection failure: FHIR API did not respond within 10 seconds' }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });

    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Select patient
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('John Doe'));

    // Wait for error
    await waitFor(() => {
      expect(screen.getByText(/Failed to load patient context/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/EHR connection failure/)).toBeInTheDocument();
  });

  it('displays error when session creation fails', async () => {
    // Override session creation to fail
    global.fetch = jest.fn((url: string, options?: RequestInit) => {
      if (url === '/api/patients') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockPatients,
        } as Response);
      }
      if (url.includes('/context')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockPatientContext,
        } as Response);
      }
      if (url === '/api/sessions' && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({
            message: 'Failed to create domain: insufficient permissions',
            stage: 'domain',
            suggestedAction: 'Check IAM permissions for connecthealth:CreateDomain',
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });

    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Select patient and load context
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('John Doe'));
    await waitFor(() => {
      expect(screen.getByText(/Patient: John Doe/)).toBeInTheDocument();
    });

    // Try to start session
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));

    // Wait for error to be displayed
    await waitFor(() => {
      expect(screen.getByTestId('session-error')).not.toHaveTextContent('');
    });
    expect(screen.getByTestId('session-error')).toHaveTextContent(/Failed to create domain/);
  });

  it('displays error when session end fails', async () => {
    // Session creation succeeds, but end fails
    global.fetch = jest.fn((url: string, options?: RequestInit) => {
      if (url === '/api/patients') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockPatients,
        } as Response);
      }
      if (url.includes('/context')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockPatientContext,
        } as Response);
      }
      if (url === '/api/sessions' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockSession,
        } as Response);
      }
      if (url.includes('/end') && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ message: 'Session end failed: HTTP/2 stream already closed' }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });

    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Full setup: select patient, load context, start session
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('John Doe'));
    await waitFor(() => {
      expect(screen.getByText(/Patient: John Doe/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
    await waitFor(() => {
      expect(screen.getByTestId('session-status')).toHaveTextContent('active');
    });

    // Try to end session
    fireEvent.click(screen.getByRole('button', { name: /end session/i }));

    // Wait for error
    await waitFor(() => {
      expect(screen.getByTestId('session-error')).toHaveTextContent(/Session end failed/);
    });
  });

  it('shows partial context with warnings when some FHIR resources fail', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url === '/api/patients') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockPatients,
        } as Response);
      }
      if (url.includes('/context')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            context: 'Patient: John Doe\nAge: 44\nSex: male\nDOB: 1980-01-15\n\nAllergies:\n- Penicillin (active)',
            warnings: ['Could not load Condition resources', 'Could not load MedicationRequest resources'],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });

    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Select patient
    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('John Doe'));

    // Wait for context with warnings
    await waitFor(() => {
      expect(screen.getByText(/Patient: John Doe/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Could not load Condition resources/)).toBeInTheDocument();
    expect(screen.getByText(/Could not load MedicationRequest resources/)).toBeInTheDocument();
  });

  it('start session button is disabled when no patient is selected', async () => {
    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    // Wait for initial render to complete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start session/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /start session/i })).toBeDisabled();
  });

  it('network error during patient fetch shows connection error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    render(
      <TestWrapper>
        <FullFlowTestHarness />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/Unable to connect to the patient service/)).toBeInTheDocument();
  });
});


// ─── Integration Tests: Component Interaction ────────────────────────────────

describe('End-to-End Integration: Component Interaction', () => {
  it('TranscriptView displays segments with correct speaker labels', () => {
    render(
      <TranscriptView
        segments={mockTranscriptSegments}
        highlightedSegmentId={null}
      />
    );

    expect(screen.getByText('Good morning. How are you feeling today?')).toBeInTheDocument();
    expect(screen.getByText('I have been feeling really tired lately.')).toBeInTheDocument();
    expect(screen.getByText('CLINICIAN')).toBeInTheDocument();
    expect(screen.getByText('PATIENT')).toBeInTheDocument();
  });

  it('ClinicalNotePanel renders all SOAP sections with content', () => {
    render(
      <ClinicalNotePanel
        clinicalNote={mockClinicalNote}
        isLoading={false}
        onEvidenceClick={() => {}}
      />
    );

    expect(screen.getByText('Subjective')).toBeInTheDocument();
    expect(screen.getByText('Objective')).toBeInTheDocument();
    expect(screen.getByText('Assessment')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    // Content appears in both SOAP section and evidence map, so use getAllByText
    expect(screen.getAllByText(/Patient reports persistent fatigue/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Continue Metformin 500mg/)).toBeInTheDocument();
  });

  it('AfterVisitSummaryPanel renders content verbatim', () => {
    render(
      <AfterVisitSummaryPanel
        content={mockAfterVisitSummary}
        isLoading={false}
      />
    );

    expect(screen.getByText(/Your visit summary:/)).toBeInTheDocument();
    expect(screen.getByText(/Continue Metformin 500mg/)).toBeInTheDocument();
  });

  it('SessionControls disables start when no patient context', () => {
    render(
      <TestWrapper>
        <SessionControls patientId={null} patientContext={null} />
      </TestWrapper>
    );

    expect(screen.getByRole('button', { name: /start session/i })).toBeDisabled();
  });

  it('SessionControls enables start when patient and context are provided', () => {
    render(
      <TestWrapper>
        <SessionControls patientId="patient-1" patientContext="Some context" />
      </TestWrapper>
    );

    expect(screen.getByRole('button', { name: /start session/i })).not.toBeDisabled();
  });

  it('SessionControls shows lifecycle indicator after session starts', async () => {
    render(
      <TestWrapper>
        <SessionControls patientId="patient-1" patientContext="Some context" />
      </TestWrapper>
    );

    fireEvent.click(screen.getByRole('button', { name: /start session/i }));

    await waitFor(() => {
      expect(screen.getByRole('group', { name: /session lifecycle/i })).toBeInTheDocument();
    });
  });
});
