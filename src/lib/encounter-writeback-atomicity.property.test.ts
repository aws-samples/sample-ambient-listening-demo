// Feature: clinical-note-writeback, Property 6: Transaction Atomicity
// **Validates: Requirements 7.2, 7.3**

import * as fc from 'fast-check';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockExecute = jest.fn();
const mockBeginTransaction = jest.fn();
const mockCommit = jest.fn();
const mockRollback = jest.fn();
const mockEnd = jest.fn();

const mockConnection = {
  execute: mockExecute,
  beginTransaction: mockBeginTransaction,
  commit: mockCommit,
  rollback: mockRollback,
  end: mockEnd,
};

jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn().mockResolvedValue(mockConnection),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      SecretString: JSON.stringify({
        host: 'test-host',
        port: 3306,
        username: 'test-user',
        password: 'test-pass',
      }),
    }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

import { createEncounterWithNote, SOAPSection } from './encounter-writeback';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/**
 * Represents the different points in the transaction where a failure can occur.
 * - 'beginTransaction': Failure when starting the transaction
 * - 'firstInsert': Failure after BEGIN but during the first INSERT (form_encounter)
 * - 'secondInsert': Failure after first INSERT but during second INSERT (form_clinical_notes)
 * - 'commit': Failure during COMMIT (after both INSERTs succeed)
 */
type FailurePoint = 'beginTransaction' | 'firstInsert' | 'secondInsert' | 'commit';

const failurePointArb: fc.Arbitrary<FailurePoint> = fc.constantFrom(
  'beginTransaction',
  'firstInsert',
  'secondInsert',
  'commit'
);

/**
 * Generates various database error types that can occur during transactions.
 */
const errorTypeArb = fc.constantFrom(
  'Connection lost: The server closed the connection.',
  'ER_LOCK_DEADLOCK: Deadlock found when trying to get lock',
  'ER_DUP_ENTRY: Duplicate entry for key PRIMARY',
  'ECONNREFUSED: Connection refused',
  'ER_LOCK_WAIT_TIMEOUT: Lock wait timeout exceeded',
  'PROTOCOL_CONNECTION_LOST',
  'ER_NO_SUCH_TABLE: Table does not exist',
  'ER_DATA_TOO_LONG: Data too long for column'
);

/** Generates a valid patient UUID string */
const patientPidArb = fc.uuid();

/** Generates valid SOAP sections (1-4 sections) */
const soapSectionsArb: fc.Arbitrary<SOAPSection[]> = fc.array(
  fc.record({
    heading: fc.constantFrom('Subjective', 'Objective', 'Assessment', 'Plan'),
    content: fc.string({ minLength: 1, maxLength: 200 }),
  }),
  { minLength: 1, maxLength: 4 }
);

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Configures the shared mock connection to fail at the specified point.
 * Clears all mock state before configuring to ensure clean state per iteration.
 */
function configureMockForFailureAt(failurePoint: FailurePoint, errorMessage: string): void {
  // Clear all call history and implementations
  mockBeginTransaction.mockReset();
  mockExecute.mockReset();
  mockCommit.mockReset();
  mockRollback.mockReset();
  mockEnd.mockReset();

  const error = new Error(errorMessage);

  // Default: all succeed
  mockBeginTransaction.mockResolvedValue(undefined);
  mockCommit.mockResolvedValue(undefined);
  mockRollback.mockResolvedValue(undefined);
  mockEnd.mockResolvedValue(undefined);

  switch (failurePoint) {
    case 'beginTransaction':
      mockBeginTransaction.mockRejectedValue(error);
      break;

    case 'firstInsert':
      mockExecute.mockRejectedValueOnce(error);
      break;

    case 'secondInsert':
      mockExecute
        .mockResolvedValueOnce([{ insertId: 999 }])
        .mockRejectedValueOnce(error);
      break;

    case 'commit':
      mockExecute
        .mockResolvedValueOnce([{ insertId: 999 }])
        .mockResolvedValueOnce([{ insertId: 1000 }]);
      mockCommit.mockRejectedValue(error);
      break;
  }
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 6: Transaction Atomicity', () => {
  it('rollback is always called when an error occurs during the transaction', async () => {
    // Run property test iterations sequentially to avoid shared mock state issues
    const samples = fc.sample(
      fc.tuple(failurePointArb, errorTypeArb, patientPidArb, soapSectionsArb),
      100
    );

    for (const [failurePoint, errorMessage, pid, sections] of samples) {
      configureMockForFailureAt(failurePoint, errorMessage);

      await expect(createEncounterWithNote(pid, sections)).rejects.toThrow();

      // rollback is called in the catch block for any error within the try block
      // beginTransaction is inside the try block, so its failure also triggers rollback
      expect(mockRollback).toHaveBeenCalledTimes(1);
    }
  });

  it('commit is never called when an error occurs before the commit step', async () => {
    const preCommitFailureArb: fc.Arbitrary<FailurePoint> = fc.constantFrom(
      'beginTransaction',
      'firstInsert',
      'secondInsert'
    );

    const samples = fc.sample(
      fc.tuple(preCommitFailureArb, errorTypeArb, patientPidArb, soapSectionsArb),
      100
    );

    for (const [failurePoint, errorMessage, pid, sections] of samples) {
      configureMockForFailureAt(failurePoint, errorMessage);

      await expect(createEncounterWithNote(pid, sections)).rejects.toThrow();

      // commit should never be called when there's an error before the commit step
      expect(mockCommit).not.toHaveBeenCalled();
    }
  });

  it('the original error is re-thrown after rollback to signal failure to the caller', async () => {
    const samples = fc.sample(
      fc.tuple(failurePointArb, errorTypeArb, patientPidArb, soapSectionsArb),
      100
    );

    for (const [failurePoint, errorMessage, pid, sections] of samples) {
      configureMockForFailureAt(failurePoint, errorMessage);

      await expect(createEncounterWithNote(pid, sections)).rejects.toThrow(errorMessage);
    }
  });

  it('connection is always closed regardless of failure point', async () => {
    const samples = fc.sample(
      fc.tuple(failurePointArb, errorTypeArb, patientPidArb, soapSectionsArb),
      100
    );

    for (const [failurePoint, errorMessage, pid, sections] of samples) {
      configureMockForFailureAt(failurePoint, errorMessage);

      await expect(createEncounterWithNote(pid, sections)).rejects.toThrow();

      // connection.end() should always be called in the finally block
      expect(mockEnd).toHaveBeenCalledTimes(1);
    }
  });

  it('no partial records remain: if first INSERT fails, second INSERT is never attempted', async () => {
    const samples = fc.sample(
      fc.tuple(errorTypeArb, patientPidArb, soapSectionsArb),
      100
    );

    for (const [errorMessage, pid, sections] of samples) {
      configureMockForFailureAt('firstInsert', errorMessage);

      await expect(createEncounterWithNote(pid, sections)).rejects.toThrow();

      // Only one execute call should have been made (the failing first INSERT)
      expect(mockExecute).toHaveBeenCalledTimes(1);
    }
  });
});
