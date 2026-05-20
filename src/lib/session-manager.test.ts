/**
 * Unit tests for the SessionManager class.
 *
 * Tests the full session lifecycle orchestration:
 * - Domain creation/reuse (matched by name)
 * - Subscription creation
 * - Session creation with patient context, channel definitions, SOAP template, and S3 output URI
 * - Session ending
 * - Error handling at each stage
 * - State change notifications
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.5, 4.6, 11.1
 */

import {
  SessionManager,
  ConnectHealthClient,
  ConnectHealthDomain,
  ConnectHealthSubscription,
  StartSessionResponse,
  DEFAULT_CHANNEL_DEFINITIONS,
  CLINICAL_NOTE_TEMPLATE_ID,
  SESSION_LANGUAGE_CODE,
  OUTPUT_S3_PATH_PREFIX,
  SessionManagerConfig,
} from './session-manager';
import type { AmbientSession } from '@/types';

// ─── Mock Client Factory ─────────────────────────────────────────────────────

function createMockClient(overrides: Partial<ConnectHealthClient> = {}): ConnectHealthClient {
  return {
    listDomains: jest.fn().mockResolvedValue([]),
    createDomain: jest.fn().mockResolvedValue({
      domainId: 'domain-123',
      domainName: 'test-domain',
      status: 'ACTIVE',
    } satisfies ConnectHealthDomain),
    createSubscription: jest.fn().mockResolvedValue({
      subscriptionId: 'sub-456',
      domainId: 'domain-123',
      status: 'ACTIVE',
    } satisfies ConnectHealthSubscription),
    startMedicalScribeListeningSession: jest.fn().mockResolvedValue({
      sessionId: 'session-789',
      streamUrl: 'https://stream.example.com/session-789',
    } satisfies StartSessionResponse),
    endSession: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const DEFAULT_CONFIG: SessionManagerConfig = {
  region: 'us-east-1',
  s3OutputBucket: 'my-output-bucket',
  domainName: 'test-domain',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SessionManager', () => {
  describe('startSession', () => {
    it('creates a new domain when none exists with the configured name', async () => {
      const client = createMockClient({
        listDomains: jest.fn().mockResolvedValue([]),
      });
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await manager.startSession('patient-1', 'Patient context text');

      expect(client.listDomains).toHaveBeenCalled();
      expect(client.createDomain).toHaveBeenCalledWith('test-domain');
    });

    it('reuses an existing domain when one matches by name', async () => {
      const existingDomain: ConnectHealthDomain = {
        domainId: 'existing-domain-id',
        domainName: 'test-domain',
        status: 'ACTIVE',
      };
      const client = createMockClient({
        listDomains: jest.fn().mockResolvedValue([existingDomain]),
      });
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await manager.startSession('patient-1', 'Patient context text');

      expect(client.listDomains).toHaveBeenCalled();
      expect(client.createDomain).not.toHaveBeenCalled();
      expect(client.createSubscription).toHaveBeenCalledWith('existing-domain-id');
    });

    it('creates a subscription under the domain', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await manager.startSession('patient-1', 'Patient context text');

      expect(client.createSubscription).toHaveBeenCalledWith('domain-123');
    });

    it('creates a session with correct patient context in encounterContext.unstructuredContext', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      const patientContext = 'Name: John Doe\nAge: 45\nAllergies: Penicillin';

      await manager.startSession('patient-1', patientContext);

      expect(client.startMedicalScribeListeningSession).toHaveBeenCalledWith(
        expect.objectContaining({
          encounterContext: {
            unstructuredContext: patientContext,
          },
        })
      );
    });

    it('configures channel definitions with CLINICIAN=0 and PATIENT=1', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await manager.startSession('patient-1', 'context');

      expect(client.startMedicalScribeListeningSession).toHaveBeenCalledWith(
        expect.objectContaining({
          channelDefinitions: DEFAULT_CHANNEL_DEFINITIONS,
        })
      );

      // Verify the actual channel definitions
      expect(DEFAULT_CHANNEL_DEFINITIONS).toEqual([
        { channelId: 0, participantRole: 'CLINICIAN' },
        { channelId: 1, participantRole: 'PATIENT' },
      ]);
    });

    it('configures PHYSICAL_SOAP template', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await manager.startSession('patient-1', 'context');

      expect(client.startMedicalScribeListeningSession).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicalNoteGenerationSettings: {
            templateId: CLINICAL_NOTE_TEMPLATE_ID,
          },
        })
      );
      expect(CLINICAL_NOTE_TEMPLATE_ID).toBe('PHYSICAL_SOAP');
    });

    it('configures output S3 URI with the correct bucket', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await manager.startSession('patient-1', 'context');

      expect(client.startMedicalScribeListeningSession).toHaveBeenCalledWith(
        expect.objectContaining({
          outputConfig: {
            s3Uri: `s3://my-output-bucket/${OUTPUT_S3_PATH_PREFIX}`,
          },
        })
      );
    });

    it('configures PHI identification for post-stream analytics', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await manager.startSession('patient-1', 'context');

      expect(client.startMedicalScribeListeningSession).toHaveBeenCalledWith(
        expect.objectContaining({
          postStreamAnalyticsSettings: {
            contentIdentificationType: 'PHI_IDENTIFICATION',
          },
        })
      );
    });

    it('configures en-US language code', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await manager.startSession('patient-1', 'context');

      expect(client.startMedicalScribeListeningSession).toHaveBeenCalledWith(
        expect.objectContaining({
          languageCode: SESSION_LANGUAGE_CODE,
        })
      );
      expect(SESSION_LANGUAGE_CODE).toBe('en-US');
    });

    it('returns an active session with correct fields', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      const session = await manager.startSession('patient-1', 'context');

      expect(session.sessionId).toBe('session-789');
      expect(session.domainId).toBe('domain-123');
      expect(session.subscriptionId).toBe('sub-456');
      expect(session.status).toBe('active');
      expect(session.patientId).toBe('patient-1');
      expect(session.patientContext).toBe('context');
      expect(session.outputS3Uri).toBe(`s3://my-output-bucket/${OUTPUT_S3_PATH_PREFIX}`);
      expect(session.startedAt).toBeInstanceOf(Date);
    });

    it('tracks lifecycle state transitions in order', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      const states: string[] = [];

      manager.onStateChange((session) => {
        states.push(session.status);
      });

      await manager.startSession('patient-1', 'context');

      expect(states).toEqual([
        'creating_domain',
        'creating_subscription',
        'creating_session',
        'active',
      ]);
    });
  });

  describe('startSession - error handling', () => {
    it('transitions to error state when domain creation fails', async () => {
      const client = createMockClient({
        listDomains: jest.fn().mockRejectedValue(new Error('Domain list failed')),
      });
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      const states: string[] = [];

      manager.onStateChange((session) => {
        states.push(session.status);
      });

      await expect(manager.startSession('patient-1', 'context')).rejects.toThrow('Domain list failed');

      expect(states).toContain('error');
    });

    it('identifies domain stage error correctly', async () => {
      const client = createMockClient({
        listDomains: jest.fn().mockRejectedValue(new Error('Domain list failed')),
      });
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      let errorSession: AmbientSession | undefined;

      manager.onStateChange((session) => {
        if (session.status === 'error') {
          errorSession = { ...session };
        }
      });

      await expect(manager.startSession('patient-1', 'context')).rejects.toThrow();

      expect(errorSession?.error?.stage).toBe('domain');
      expect(errorSession?.error?.message).toBe('Domain list failed');
      expect(errorSession?.error?.suggestedAction).toBeTruthy();
    });

    it('identifies subscription stage error correctly', async () => {
      const client = createMockClient({
        createSubscription: jest.fn().mockRejectedValue(new Error('Subscription failed')),
      });
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      let errorSession: AmbientSession | undefined;

      manager.onStateChange((session) => {
        if (session.status === 'error') {
          errorSession = { ...session };
        }
      });

      await expect(manager.startSession('patient-1', 'context')).rejects.toThrow();

      expect(errorSession?.error?.stage).toBe('subscription');
    });

    it('identifies session creation stage error correctly', async () => {
      const client = createMockClient({
        startMedicalScribeListeningSession: jest.fn().mockRejectedValue(new Error('Session creation failed')),
      });
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      let errorSession: AmbientSession | undefined;

      manager.onStateChange((session) => {
        if (session.status === 'error') {
          errorSession = { ...session };
        }
      });

      await expect(manager.startSession('patient-1', 'context')).rejects.toThrow();

      expect(errorSession?.error?.stage).toBe('session');
    });
  });

  describe('endSession', () => {
    it('ends an active session successfully', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      const session = await manager.startSession('patient-1', 'context');
      const endedSession = await manager.endSession(session.sessionId);

      expect(endedSession.status).toBe('ended');
      expect(endedSession.endedAt).toBeInstanceOf(Date);
      expect(client.endSession).toHaveBeenCalledWith('session-789');
    });

    it('tracks ending → ended state transitions', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      const states: string[] = [];

      const session = await manager.startSession('patient-1', 'context');

      // Reset states to only track end transitions
      states.length = 0;
      manager.onStateChange((s) => {
        states.push(s.status);
      });

      await manager.endSession(session.sessionId);

      expect(states).toEqual(['ending', 'ended']);
    });

    it('throws when session is not found', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      await expect(manager.endSession('nonexistent')).rejects.toThrow('Session not found');
    });

    it('throws when session is not in active state', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      const session = await manager.startSession('patient-1', 'context');
      await manager.endSession(session.sessionId);

      // Try to end again
      await expect(manager.endSession(session.sessionId)).rejects.toThrow(
        "Cannot end session in 'ended' state"
      );
    });

    it('transitions to error state when end fails', async () => {
      const client = createMockClient({
        endSession: jest.fn().mockRejectedValue(new Error('End failed')),
      });
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      const session = await manager.startSession('patient-1', 'context');

      let errorSession: AmbientSession | undefined;
      manager.onStateChange((s) => {
        if (s.status === 'error') {
          errorSession = { ...s };
        }
      });

      await expect(manager.endSession(session.sessionId)).rejects.toThrow('End failed');

      expect(errorSession?.error?.stage).toBe('streaming');
    });
  });

  describe('state change listeners', () => {
    it('notifies multiple listeners', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      const listener1States: string[] = [];
      const listener2States: string[] = [];

      manager.onStateChange((s) => listener1States.push(s.status));
      manager.onStateChange((s) => listener2States.push(s.status));

      await manager.startSession('patient-1', 'context');

      expect(listener1States).toEqual(listener2States);
      expect(listener1States.length).toBe(4);
    });

    it('allows removing listeners', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);
      const states: string[] = [];
      const listener = (s: AmbientSession) => states.push(s.status);

      manager.onStateChange(listener);
      manager.removeStateChangeListener(listener);

      await manager.startSession('patient-1', 'context');

      expect(states).toEqual([]);
    });
  });

  describe('getSession', () => {
    it('returns the session after creation', async () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      const session = await manager.startSession('patient-1', 'context');
      const retrieved = manager.getSession(session.sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe('session-789');
      expect(retrieved?.status).toBe('active');
    });

    it('returns undefined for unknown session ID', () => {
      const client = createMockClient();
      const manager = new SessionManager(DEFAULT_CONFIG, client);

      expect(manager.getSession('unknown')).toBeUndefined();
    });
  });

  describe('fromConfig', () => {
    it('creates a SessionManager from ValidatedConfig', () => {
      const client = createMockClient();
      const validatedConfig = {
        aws: {
          region: 'us-east-1' as const,
          s3OutputBucket: 'my-bucket',
        },
        openemr: {
          fhirBaseUrl: 'https://fhir.example.com',
        },
        connectHealth: {
          domainName: 'my-domain',
        },
      };

      const manager = SessionManager.fromConfig(validatedConfig, client);

      expect(manager).toBeInstanceOf(SessionManager);
    });
  });
});
