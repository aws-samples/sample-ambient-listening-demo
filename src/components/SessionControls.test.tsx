/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SessionControls, SessionLifecycleIndicator } from './SessionControls';

// ─── Mock useSession ─────────────────────────────────────────────────────────

const mockStartSession = jest.fn();
const mockEndSession = jest.fn();

const defaultSessionState = {
  session: null,
  transcriptSegments: [],
  clinicalNote: null,
  afterVisitSummary: null,
  isLoading: false,
  error: null,
};

let mockState = { ...defaultSessionState };

jest.mock('@/lib/session-context', () => ({
  useSession: () => ({
    state: mockState,
    startSession: mockStartSession,
    endSession: mockEndSession,
    addTranscript: jest.fn(),
    setOutputs: jest.fn(),
    setError: jest.fn(),
    reset: jest.fn(),
  }),
}));

// ─── SessionLifecycleIndicator Tests ─────────────────────────────────────────

describe('SessionLifecycleIndicator', () => {
  it('renders nothing when currentStage is null', () => {
    const { container } = render(<SessionLifecycleIndicator currentStage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all lifecycle stages', () => {
    render(<SessionLifecycleIndicator currentStage="active" />);
    expect(screen.getByText('Domain Setup')).toBeInTheDocument();
    expect(screen.getByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('Session Creation')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Ending')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
  });

  it('marks completed stages with checkmarks', () => {
    render(<SessionLifecycleIndicator currentStage="active" />);
    const group = screen.getByRole('group', { name: /session lifecycle stages/i });
    expect(group).toBeInTheDocument();
    // Stages before "active" (index 3) should be completed
    expect(screen.getByLabelText('Domain Setup (completed)')).toBeInTheDocument();
    expect(screen.getByLabelText('Subscription (completed)')).toBeInTheDocument();
    expect(screen.getByLabelText('Session Creation (completed)')).toBeInTheDocument();
  });

  it('marks the current stage', () => {
    render(<SessionLifecycleIndicator currentStage="creating_subscription" />);
    expect(screen.getByLabelText('Subscription (current)')).toBeInTheDocument();
  });

  it('shows error indicator when stage is error', () => {
    render(<SessionLifecycleIndicator currentStage="error" />);
    expect(screen.getByText('Session encountered an error')).toBeInTheDocument();
  });
});

// ─── SessionControls Tests ───────────────────────────────────────────────────

describe('SessionControls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = { ...defaultSessionState };
  });

  it('renders audio source radio buttons', () => {
    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByLabelText('Microphone')).toBeInTheDocument();
    expect(screen.getByLabelText('WAV File')).toBeInTheDocument();
  });

  it('defaults to microphone audio source', () => {
    render(<SessionControls patientId="p1" patientContext="context" />);
    const micRadio = screen.getByLabelText('Microphone') as HTMLInputElement;
    expect(micRadio.checked).toBe(true);
  });

  it('shows file input when WAV source is selected', () => {
    render(<SessionControls patientId="p1" patientContext="context" />);
    fireEvent.click(screen.getByLabelText('WAV File'));
    expect(screen.getByText('Choose File')).toBeInTheDocument();
    expect(screen.getByText('No file selected')).toBeInTheDocument();
  });

  it('calls onAudioSourceChange when source changes', () => {
    const onAudioSourceChange = jest.fn();
    render(
      <SessionControls patientId="p1" patientContext="context" onAudioSourceChange={onAudioSourceChange} />,
    );
    fireEvent.click(screen.getByLabelText('WAV File'));
    expect(onAudioSourceChange).toHaveBeenCalledWith('wav', undefined);

    fireEvent.click(screen.getByLabelText('Microphone'));
    expect(onAudioSourceChange).toHaveBeenCalledWith('microphone');
  });

  it('disables Start Session when patientId is null', () => {
    render(<SessionControls patientId={null} patientContext="context" />);
    expect(screen.getByLabelText('Start session')).toBeDisabled();
  });

  it('disables Start Session when patientContext is null', () => {
    render(<SessionControls patientId="p1" patientContext={null} />);
    expect(screen.getByLabelText('Start session')).toBeDisabled();
  });

  it('enables Start Session when patientId and patientContext are provided', () => {
    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByLabelText('Start session')).toBeEnabled();
  });

  it('calls startSession when Start Session is clicked', () => {
    render(<SessionControls patientId="p1" patientContext="some context" />);
    fireEvent.click(screen.getByLabelText('Start session'));
    expect(mockStartSession).toHaveBeenCalledWith('p1', 'some context');
  });

  it('disables End Session when no session is active', () => {
    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByLabelText('End session')).toBeDisabled();
  });

  it('enables End Session when session is active', () => {
    mockState = {
      ...defaultSessionState,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'active',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByLabelText('End session')).toBeEnabled();
  });

  it('calls endSession when End Session is clicked', () => {
    mockState = {
      ...defaultSessionState,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'active',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    fireEvent.click(screen.getByLabelText('End session'));
    expect(mockEndSession).toHaveBeenCalled();
  });

  it('disables Start Session when a session already exists', () => {
    mockState = {
      ...defaultSessionState,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'active',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByLabelText('Start session')).toBeDisabled();
  });

  it('shows lifecycle indicator when session exists', () => {
    mockState = {
      ...defaultSessionState,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'creating_domain',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByRole('group', { name: /session lifecycle stages/i })).toBeInTheDocument();
  });

  it('displays error message from session state', () => {
    mockState = {
      ...defaultSessionState,
      error: 'Failed to create domain: permission denied',
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Session Error')).toBeInTheDocument();
    expect(screen.getByText('Failed to create domain: permission denied')).toBeInTheDocument();
  });

  it('displays suggested action from session error', () => {
    mockState = {
      ...defaultSessionState,
      error: 'Domain creation failed',
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'error',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
        error: {
          stage: 'domain',
          message: 'Domain creation failed',
          suggestedAction: 'Check IAM permissions for connecthealth:CreateDomain',
        },
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(
      screen.getByText('Suggestion: Check IAM permissions for connecthealth:CreateDomain'),
    ).toBeInTheDocument();
  });

  it('shows "Starting…" text when loading without session', () => {
    mockState = {
      ...defaultSessionState,
      isLoading: true,
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByText('Starting…')).toBeInTheDocument();
  });

  it('shows "Ending…" text when session is ending', () => {
    mockState = {
      ...defaultSessionState,
      isLoading: true,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'ending',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByText('Ending…')).toBeInTheDocument();
  });

  it('shows active indicator when session is active', () => {
    mockState = {
      ...defaultSessionState,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'active',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByText('Session active')).toBeInTheDocument();
  });

  it('shows "Setting up…" indicator during session creation stages', () => {
    mockState = {
      ...defaultSessionState,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'creating_session',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByText('Setting up…')).toBeInTheDocument();
  });

  it('shows "Session ended" when session has ended', () => {
    mockState = {
      ...defaultSessionState,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'ended',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
        endedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    expect(screen.getByText('Session ended')).toBeInTheDocument();
  });

  it('disables audio source selection when session is active', () => {
    mockState = {
      ...defaultSessionState,
      session: {
        sessionId: 's1',
        domainId: 'd1',
        subscriptionId: 'sub1',
        status: 'active',
        patientId: 'p1',
        patientContext: 'context',
        outputS3Uri: 's3://bucket/path',
        startedAt: new Date(),
      },
    };

    render(<SessionControls patientId="p1" patientContext="context" />);
    const fieldset = screen.getByRole('group', { name: /audio source/i });
    expect(fieldset).toBeDisabled();
  });
});
