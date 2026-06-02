// Feature: clinical-note-writeback, Property 8: Successful Response Includes Encounter ID
// **Validates: Requirements 6.5**

import * as fc from 'fast-check';
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

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generates valid positive encounter IDs (integers > 0). */
const validEncounterIdArb = fc.integer({ min: 1, max: 2_147_483_647 });

/** Generates valid Date objects for createdAt timestamps. */
const validDateArb = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2099-12-31T23:59:59.999Z'),
});

/** Generates valid patient UUIDs (non-empty strings). */
const validPatientUuidArb = fc.uuid();

/** Generates valid patient PIDs (positive integers). */
const validPatientPidArb = fc.integer({ min: 1, max: 100_000 });

/** Generates valid SOAP section content (non-empty strings). */
const validSectionContentArb = fc.string({ minLength: 1, maxLength: 500 }).filter(
  (s) => s.trim().length > 0
);

/** Generates a valid sections array with at least one non-empty section. */
const validSectionsArb = fc.array(
  fc.record({
    heading: fc.constantFrom('Subjective', 'Objective', 'Assessment', 'Plan'),
    content: validSectionContentArb,
  }),
  { minLength: 1, maxLength: 4 }
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createRequest(body: unknown): Request {
  return new Request('http://localhost/api/encounters/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Validates that a string is a valid ISO 8601 date-time. */
function isValidIso8601(dateStr: string): boolean {
  const parsed = Date.parse(dateStr);
  if (isNaN(parsed)) return false;
  // Verify it round-trips correctly through Date
  const reconstructed = new Date(parsed).toISOString();
  return reconstructed === dateStr;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 8: Successful Response Includes Encounter ID', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns status 201 with numeric encounterId > 0 and valid ISO 8601 createdAt for any successful writeback', async () => {
    await fc.assert(
      fc.asyncProperty(
        validPatientUuidArb,
        validPatientPidArb,
        validSectionsArb,
        validEncounterIdArb,
        validDateArb,
        async (patientUuid, patientPid, sections, encounterId, createdAt) => {
          // Arrange: mock successful resolution and creation
          mockGetPatientPidFromUuid.mockReset();
          mockCreateEncounterWithNote.mockReset();
          mockGetPatientPidFromUuid.mockResolvedValue(patientPid);
          mockCreateEncounterWithNote.mockResolvedValue({
            encounterId,
            createdAt,
          });

          // Act
          const response = await POST(createRequest({
            patientId: patientUuid,
            sections,
          }));
          const body = await response.json();

          // Assert: status is 201
          expect(response.status).toBe(201);

          // Assert: encounterId is a number greater than 0
          expect(typeof body.encounterId).toBe('number');
          expect(body.encounterId).toBeGreaterThan(0);
          expect(body.encounterId).toBe(encounterId);

          // Assert: createdAt is a valid ISO 8601 string
          expect(typeof body.createdAt).toBe('string');
          expect(isValidIso8601(body.createdAt)).toBe(true);

          // Assert: createdAt matches the expected date
          expect(body.createdAt).toBe(createdAt.toISOString());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('response body contains only encounterId and createdAt fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        validPatientUuidArb,
        validPatientPidArb,
        validSectionsArb,
        validEncounterIdArb,
        validDateArb,
        async (patientUuid, patientPid, sections, encounterId, createdAt) => {
          mockGetPatientPidFromUuid.mockReset();
          mockCreateEncounterWithNote.mockReset();
          mockGetPatientPidFromUuid.mockResolvedValue(patientPid);
          mockCreateEncounterWithNote.mockResolvedValue({
            encounterId,
            createdAt,
          });

          const response = await POST(createRequest({
            patientId: patientUuid,
            sections,
          }));
          const body = await response.json();

          // Assert: response body has exactly the expected shape
          const keys = Object.keys(body);
          expect(keys).toContain('encounterId');
          expect(keys).toContain('createdAt');
          expect(keys.length).toBe(2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('encounterId is always an integer (not a float)', async () => {
    await fc.assert(
      fc.asyncProperty(
        validPatientUuidArb,
        validPatientPidArb,
        validSectionsArb,
        validEncounterIdArb,
        validDateArb,
        async (patientUuid, patientPid, sections, encounterId, createdAt) => {
          mockGetPatientPidFromUuid.mockReset();
          mockCreateEncounterWithNote.mockReset();
          mockGetPatientPidFromUuid.mockResolvedValue(patientPid);
          mockCreateEncounterWithNote.mockResolvedValue({
            encounterId,
            createdAt,
          });

          const response = await POST(createRequest({
            patientId: patientUuid,
            sections,
          }));
          const body = await response.json();

          // Assert: encounterId is an integer
          expect(Number.isInteger(body.encounterId)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
