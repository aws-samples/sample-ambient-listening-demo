/**
 * Unit tests for POST /api/encounters/create route.
 */

import { POST } from './route';

// Mock the encounter-notes module
jest.mock('@/lib/encounter-notes', () => ({
  getPatientPidFromUuid: jest.fn(),
}));

// Mock the encounter-writeback module
jest.mock('@/lib/encounter-writeback', () => ({
  createEncounterWithNote: jest.fn(),
}));

import { getPatientPidFromUuid } from '@/lib/encounter-notes';
import { createEncounterWithNote } from '@/lib/encounter-writeback';

const mockGetPatientPidFromUuid = getPatientPidFromUuid as jest.MockedFunction<typeof getPatientPidFromUuid>;
const mockCreateEncounterWithNote = createEncounterWithNote as jest.MockedFunction<typeof createEncounterWithNote>;

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/encounters/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createInvalidJsonRequest(): Request {
  return new Request('http://localhost/api/encounters/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not valid json{{{',
  });
}

describe('POST /api/encounters/create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validation errors (400)', () => {
    it('returns 400 for invalid JSON body', async () => {
      const response = await POST(createInvalidJsonRequest());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('INVALID_JSON');
    });

    it('returns 400 when patientId is missing', async () => {
      const response = await POST(createRequest({
        sections: [{ heading: 'Subjective', content: 'Patient reports headache' }],
      }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('patientId');
    });

    it('returns 400 when patientId is empty string', async () => {
      const response = await POST(createRequest({
        patientId: '   ',
        sections: [{ heading: 'Subjective', content: 'Patient reports headache' }],
      }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('patientId');
    });

    it('returns 400 when sections array is missing', async () => {
      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
      }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('section');
    });

    it('returns 400 when sections array is empty', async () => {
      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [],
      }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('section');
    });

    it('returns 400 when all sections have empty content', async () => {
      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [
          { heading: 'Subjective', content: '' },
          { heading: 'Objective', content: '   ' },
        ],
      }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toContain('non-empty');
    });
  });

  describe('patient not found (404)', () => {
    it('returns 404 when patient UUID cannot be resolved', async () => {
      mockGetPatientPidFromUuid.mockResolvedValue(null);

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [{ heading: 'Subjective', content: 'Patient reports headache' }],
      }));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.code).toBe('PATIENT_NOT_FOUND');
      expect(body.message).toBe('Patient not found');
      expect(mockGetPatientPidFromUuid).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('successful creation (201)', () => {
    it('returns 201 with encounterId and createdAt on success', async () => {
      const createdAt = new Date('2024-01-15T10:30:00.000Z');
      mockGetPatientPidFromUuid.mockResolvedValue(42);
      mockCreateEncounterWithNote.mockResolvedValue({
        encounterId: 101,
        createdAt,
      });

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [
          { heading: 'Subjective', content: 'Patient reports headache' },
          { heading: 'Objective', content: 'BP 120/80' },
        ],
      }));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.encounterId).toBe(101);
      expect(body.createdAt).toBe('2024-01-15T10:30:00.000Z');
      expect(mockCreateEncounterWithNote).toHaveBeenCalledWith(42, [
        { heading: 'Subjective', content: 'Patient reports headache' },
        { heading: 'Objective', content: 'BP 120/80' },
      ]);
    });

    it('filters out sections with empty content before creating encounter', async () => {
      const createdAt = new Date('2024-01-15T10:30:00.000Z');
      mockGetPatientPidFromUuid.mockResolvedValue(42);
      mockCreateEncounterWithNote.mockResolvedValue({
        encounterId: 102,
        createdAt,
      });

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [
          { heading: 'Subjective', content: 'Patient reports headache' },
          { heading: 'Objective', content: '' },
          { heading: 'Assessment', content: 'Tension headache' },
        ],
      }));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.encounterId).toBe(102);
      // Only non-empty sections should be passed
      expect(mockCreateEncounterWithNote).toHaveBeenCalledWith(42, [
        { heading: 'Subjective', content: 'Patient reports headache' },
        { heading: 'Assessment', content: 'Tension headache' },
      ]);
    });
  });

  describe('database errors (500)', () => {
    it('returns 500 with generic message on database error', async () => {
      mockGetPatientPidFromUuid.mockRejectedValue(new Error('Connection refused to db.internal:3306'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [{ heading: 'Subjective', content: 'Patient reports headache' }],
      }));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.message).toBe('Unable to process request. Please try again.');
      // Ensure no internal details are leaked
      expect(JSON.stringify(body)).not.toContain('Connection refused');
      expect(JSON.stringify(body)).not.toContain('db.internal');
      expect(JSON.stringify(body)).not.toContain('3306');

      // Verify error was logged server-side
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('returns 500 when createEncounterWithNote throws', async () => {
      mockGetPatientPidFromUuid.mockResolvedValue(42);
      mockCreateEncounterWithNote.mockRejectedValue(new Error('DEADLOCK detected'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await POST(createRequest({
        patientId: '550e8400-e29b-41d4-a716-446655440000',
        sections: [{ heading: 'Subjective', content: 'Patient reports headache' }],
      }));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(body)).not.toContain('DEADLOCK');

      consoleSpy.mockRestore();
    });
  });
});
