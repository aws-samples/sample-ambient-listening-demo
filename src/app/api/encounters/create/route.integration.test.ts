/**
 * Integration tests for the clinical note writeback flow.
 *
 * Tests the full path: API route → validation → UUID resolution → encounter creation → response.
 * Database modules are mocked since we can't connect to a real database in tests,
 * but the full route handler logic (parsing, validation, filtering, error handling) is exercised.
 *
 * Requirements: 4.1, 4.3, 7.2
 */

import { POST } from './route';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

jest.mock('@/lib/encounter-notes', () => ({
  getPatientPidFromUuid: jest.fn(),
}));

jest.mock('@/lib/encounter-writeback', () => ({
  createEncounterWithNote: jest.fn(),
}));

import { getPatientPidFromUuid } from '@/lib/encounter-notes';
import { createEncounterWithNote } from '@/lib/encounter-writeback';

const mockGetPatientPidFromUuid = getPatientPidFromUuid as jest.MockedFunction<typeof getPatientPidFromUuid>;
const mockCreateEncounterWithNote = createEncounterWithNote as jest.MockedFunction<typeof createEncounterWithNote>;

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Known UUID→PID mappings simulating the patient_data table. */
const KNOWN_PATIENTS: Record<string, number> = {
  '550e8400-e29b-41d4-a716-446655440000': 1,
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8': 42,
  'f47ac10b-58cc-4372-a567-0e02b2c3d479': 100,
};

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/encounters/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Integration: Clinical Note Writeback Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default: resolve UUIDs using the known patient map
    mockGetPatientPidFromUuid.mockImplementation(async (uuid: string) => {
      return KNOWN_PATIENTS[uuid] ?? null;
    });
  });

  // ─── Scenario 1: Full Successful Flow ────────────────────────────────────

  describe('Full successful flow', () => {
    it('valid request → UUID resolves → encounter created → 201 with correct shape', async () => {
      const createdAt = new Date('2024-03-15T14:30:00.000Z');
      mockCreateEncounterWithNote.mockResolvedValue({
        encounterId: 501,
        createdAt,
      });

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [
          { heading: 'Subjective', content: 'Patient presents with chronic lower back pain.' },
          { heading: 'Assessment', content: 'Lumbar strain, chronic.' },
        ],
        sessionId: 'session-abc-123',
      }));

      const body = await response.json();

      // Verify response status and shape
      expect(response.status).toBe(201);
      expect(body).toHaveProperty('encounterId');
      expect(body).toHaveProperty('createdAt');
      expect(typeof body.encounterId).toBe('number');
      expect(body.encounterId).toBe(501);
      expect(body.createdAt).toBe('2024-03-15T14:30:00.000Z');

      // Verify the UUID was resolved
      expect(mockGetPatientPidFromUuid).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');

      // Verify encounter creation was called with resolved PID and sections
      expect(mockCreateEncounterWithNote).toHaveBeenCalledTimes(1);
      expect(mockCreateEncounterWithNote).toHaveBeenCalledWith(1, [
        { heading: 'Subjective', content: 'Patient presents with chronic lower back pain.' },
        { heading: 'Assessment', content: 'Lumbar strain, chronic.' },
      ]);
    });

    it('returns valid ISO 8601 createdAt timestamp', async () => {
      const createdAt = new Date('2024-06-01T09:00:00.000Z');
      mockCreateEncounterWithNote.mockResolvedValue({
        encounterId: 777,
        createdAt,
      });

      const response = await POST(createRequest({
        patientId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        sections: [{ heading: 'Subjective', content: 'Follow-up visit.' }],
      }));

      const body = await response.json();
      expect(response.status).toBe(201);

      // Verify createdAt is a valid ISO 8601 string
      const parsed = new Date(body.createdAt);
      expect(parsed.toISOString()).toBe(body.createdAt);
      expect(isNaN(parsed.getTime())).toBe(false);
    });
  });

  // ─── Scenario 2: UUID Resolution ────────────────────────────────────────

  describe('UUID resolution with known test data', () => {
    it('resolves UUID to correct PID and passes it to createEncounterWithNote', async () => {
      const createdAt = new Date();
      mockCreateEncounterWithNote.mockResolvedValue({ encounterId: 200, createdAt });

      // Test with second known patient
      const response = await POST(createRequest({
        patientId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        sections: [{ heading: 'Objective', content: 'Vitals stable.' }],
      }));

      expect(response.status).toBe(201);
      expect(mockGetPatientPidFromUuid).toHaveBeenCalledWith('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
      // Verify the correct PID (42) was passed to the writeback module
      expect(mockCreateEncounterWithNote).toHaveBeenCalledWith(
        42,
        [{ heading: 'Objective', content: 'Vitals stable.' }]
      );
    });

    it('resolves different UUIDs to different PIDs', async () => {
      const createdAt = new Date();
      mockCreateEncounterWithNote.mockResolvedValue({ encounterId: 300, createdAt });

      // Test with third known patient
      const response = await POST(createRequest({
        patientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        sections: [{ heading: 'Plan', content: 'Continue current medications.' }],
      }));

      expect(response.status).toBe(201);
      expect(mockGetPatientPidFromUuid).toHaveBeenCalledWith('f47ac10b-58cc-4372-a567-0e02b2c3d479');
      // Verify the correct PID (100) was passed to the writeback module
      expect(mockCreateEncounterWithNote).toHaveBeenCalledWith(
        100,
        [{ heading: 'Plan', content: 'Continue current medications.' }]
      );
    });

    it('returns 404 when UUID does not map to any patient', async () => {
      const response = await POST(createRequest({
        patientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        sections: [{ heading: 'Subjective', content: 'Some content.' }],
      }));

      const body = await response.json();
      expect(response.status).toBe(404);
      expect(body.code).toBe('PATIENT_NOT_FOUND');
      expect(body.message).toBe('Patient not found');

      // Verify createEncounterWithNote was never called
      expect(mockCreateEncounterWithNote).not.toHaveBeenCalled();
    });
  });

  // ─── Scenario 3: Transaction Rollback on Failure ─────────────────────────

  describe('Transaction rollback on forced failure', () => {
    it('returns 500 when createEncounterWithNote throws a database error', async () => {
      mockCreateEncounterWithNote.mockRejectedValue(
        new Error('ER_LOCK_DEADLOCK: Deadlock found when trying to get lock')
      );

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [{ heading: 'Subjective', content: 'Patient reports dizziness.' }],
      }));

      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.message).toBe('Unable to process request. Please try again.');

      // Verify no internal database details are leaked
      expect(JSON.stringify(body)).not.toContain('DEADLOCK');
      expect(JSON.stringify(body)).not.toContain('ER_LOCK_DEADLOCK');

      // Verify the error was logged server-side for debugging
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Encounters] Encounter creation failed:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('returns 500 when createEncounterWithNote throws a connection error', async () => {
      mockCreateEncounterWithNote.mockRejectedValue(
        new Error('ECONNREFUSED: connect ECONNREFUSED 10.0.1.5:3306')
      );

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await POST(createRequest({
        patientId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        sections: [{ heading: 'Assessment', content: 'Hypertension, controlled.' }],
      }));

      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');

      // No IP addresses or port numbers leaked
      expect(JSON.stringify(body)).not.toContain('10.0.1.5');
      expect(JSON.stringify(body)).not.toContain('3306');
      expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');

      consoleSpy.mockRestore();
    });

    it('returns 500 when UUID resolution throws unexpectedly', async () => {
      mockGetPatientPidFromUuid.mockRejectedValue(
        new Error('Secrets Manager timeout: unable to retrieve credentials')
      );

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [{ heading: 'Subjective', content: 'Routine checkup.' }],
      }));

      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(body)).not.toContain('Secrets Manager');
      expect(JSON.stringify(body)).not.toContain('credentials');

      // createEncounterWithNote should not have been called
      expect(mockCreateEncounterWithNote).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // ─── Scenario 4: Multiple Sections (All 4 SOAP) ─────────────────────────

  describe('Multiple sections submission', () => {
    it('submits all 4 SOAP sections and passes them through to writeback', async () => {
      const createdAt = new Date('2024-04-20T16:00:00.000Z');
      mockCreateEncounterWithNote.mockResolvedValue({ encounterId: 600, createdAt });

      const allSections = [
        { heading: 'Subjective', content: 'Patient reports persistent cough for 2 weeks.' },
        { heading: 'Objective', content: 'Lungs clear to auscultation. Temp 98.6F. O2 sat 98%.' },
        { heading: 'Assessment', content: 'Upper respiratory infection, resolving.' },
        { heading: 'Plan', content: 'Continue fluids. Follow up in 1 week if symptoms persist.' },
      ];

      const response = await POST(createRequest({
        patientId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        sections: allSections,
      }));

      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.encounterId).toBe(600);

      // Verify all 4 sections were passed to createEncounterWithNote
      expect(mockCreateEncounterWithNote).toHaveBeenCalledWith(100, allSections);

      // Verify the exact section count
      const passedSections = mockCreateEncounterWithNote.mock.calls[0]![1] as Array<{heading: string; content: string}>;
      expect(passedSections).toHaveLength(4);
      expect(passedSections[0]!.heading).toBe('Subjective');
      expect(passedSections[1]!.heading).toBe('Objective');
      expect(passedSections[2]!.heading).toBe('Assessment');
      expect(passedSections[3]!.heading).toBe('Plan');
    });
  });

  // ─── Scenario 5: Empty Section Filtering ─────────────────────────────────

  describe('Empty section filtering', () => {
    it('filters out sections with empty content before passing to writeback', async () => {
      const createdAt = new Date('2024-05-10T08:00:00.000Z');
      mockCreateEncounterWithNote.mockResolvedValue({ encounterId: 700, createdAt });

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [
          { heading: 'Subjective', content: 'Patient feels better today.' },
          { heading: 'Objective', content: '' },
          { heading: 'Assessment', content: 'Improving.' },
          { heading: 'Plan', content: '   ' },
        ],
      }));

      await response.json();

      expect(response.status).toBe(201);

      // Only non-empty sections should reach the writeback module
      expect(mockCreateEncounterWithNote).toHaveBeenCalledWith(1, [
        { heading: 'Subjective', content: 'Patient feels better today.' },
        { heading: 'Assessment', content: 'Improving.' },
      ]);

      // Verify filtered count
      const passedSections = mockCreateEncounterWithNote.mock.calls[0]![1] as Array<{heading: string; content: string}>;
      expect(passedSections).toHaveLength(2);
    });

    it('filters out sections with whitespace-only content', async () => {
      const createdAt = new Date();
      mockCreateEncounterWithNote.mockResolvedValue({ encounterId: 701, createdAt });

      const response = await POST(createRequest({
        patientId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        sections: [
          { heading: 'Subjective', content: '\n\n\t  ' },
          { heading: 'Objective', content: 'BP 130/85, HR 72.' },
          { heading: 'Assessment', content: '' },
          { heading: 'Plan', content: 'Recheck in 3 months.' },
        ],
      }));

      expect(response.status).toBe(201);

      // Only Objective and Plan have non-empty trimmed content
      expect(mockCreateEncounterWithNote).toHaveBeenCalledWith(42, [
        { heading: 'Objective', content: 'BP 130/85, HR 72.' },
        { heading: 'Plan', content: 'Recheck in 3 months.' },
      ]);
    });

    it('returns 400 when all sections are empty after filtering', async () => {
      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [
          { heading: 'Subjective', content: '' },
          { heading: 'Objective', content: '   ' },
          { heading: 'Assessment', content: '\t\n' },
        ],
      }));

      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('non-empty');

      // Neither UUID resolution nor encounter creation should be attempted
      expect(mockGetPatientPidFromUuid).not.toHaveBeenCalled();
      expect(mockCreateEncounterWithNote).not.toHaveBeenCalled();
    });
  });
});
