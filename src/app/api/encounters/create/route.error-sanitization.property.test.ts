// Feature: clinical-note-writeback, Property 9: Database Errors Return Generic 500
// **Validates: Requirements 6.6**

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

/** Generates realistic database hostnames. */
const hostnameArb = fc.oneof(
  fc.constant('db.internal.company.com'),
  fc.constant('prod-aurora-cluster.us-east-1.rds.amazonaws.com'),
  fc.constant('mysql-primary.vpc-0abc123.internal'),
  fc.tuple(
    fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'), { minLength: 3, maxLength: 10 }),
    fc.constantFrom('.internal.corp', '.rds.amazonaws.com', '.database.azure.com', '.db.local')
  ).map(([host, domain]) => `${host}${domain}`)
);

/** Generates credential-like strings. */
const credentialArb = fc.oneof(
  fc.constant('password=SuperSecret123!'),
  fc.constant('user=admin&pass=hunter2'),
  fc.constant('mysql://root:p@ssw0rd@localhost:3306/openemr'),
  fc.constant('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'),
  fc.tuple(
    fc.constantFrom('password', 'passwd', 'secret', 'token', 'api_key'),
    fc.string({ minLength: 5, maxLength: 30 })
  ).map(([key, val]) => `${key}=${val}`)
);

/** Generates SQL statement fragments. */
const sqlArb = fc.oneof(
  fc.constant('SELECT * FROM patient_data WHERE pid = 42'),
  fc.constant("INSERT INTO form_encounter (date, reason) VALUES ('2024-01-01', 'test')"),
  fc.constant('UPDATE form_clinical_notes SET description = ? WHERE encounter = 101'),
  fc.constant("DELETE FROM sessions WHERE id = 'abc-123'"),
  fc.constant('SHOW TABLES FROM openemr'),
  fc.tuple(
    fc.constantFrom('SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM'),
    fc.constantFrom('patient_data', 'form_encounter', 'form_clinical_notes', 'users'),
    fc.constantFrom(' WHERE ', ' SET ', ' VALUES ')
  ).map(([op, table, clause]) => `${op} ${table}${clause}id = 1`)
);

/** Generates stack trace fragments. */
const stackTraceArb = fc.oneof(
  fc.constant('at Connection.execute (/node_modules/mysql2/lib/connection.js:210:17)'),
  fc.constant('Error: connect ECONNREFUSED 10.0.1.42:3306\n    at TCPConnectWrap.afterConnect'),
  fc.constant('at Object.<anonymous> (/app/src/lib/encounter-writeback.ts:45:12)'),
  fc.tuple(
    fc.constantFrom('/app/src/', '/node_modules/', '/usr/local/lib/'),
    fc.string({ minLength: 5, maxLength: 20 }),
    fc.nat({ max: 500 })
  ).map(([path, file, line]) => `at Module (${path}${file}.js:${line}:10)`)
);

/** Generates port numbers as strings. */
const portArb = fc.oneof(
  fc.constant('3306'),
  fc.constant('5432'),
  fc.constant('27017'),
  fc.integer({ min: 1024, max: 65535 }).map(String)
);

/** Generates IP addresses. */
const ipAddressArb = fc.tuple(
  fc.nat({ max: 255 }),
  fc.nat({ max: 255 }),
  fc.nat({ max: 255 }),
  fc.nat({ max: 255 })
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Generates composite error messages containing multiple sensitive elements. */
const sensitiveErrorMessageArb = fc.oneof(
  // Hostname-based errors
  hostnameArb.map((host) => `Connection refused to ${host}`),
  // Credential-based errors
  credentialArb.map((cred) => `Authentication failed: ${cred}`),
  // SQL-based errors
  sqlArb.map((sql) => `Query failed: ${sql}`),
  // Stack trace errors
  stackTraceArb.map((trace) => `Unhandled error\n${trace}`),
  // Port-based errors
  fc.tuple(hostnameArb, portArb).map(([host, port]) => `ECONNREFUSED ${host}:${port}`),
  // IP address errors
  fc.tuple(ipAddressArb, portArb).map(([ip, port]) => `connect ETIMEDOUT ${ip}:${port}`),
  // Combined sensitive content
  fc.tuple(hostnameArb, credentialArb, sqlArb).map(
    ([host, cred, sql]) => `Error on ${host} with ${cred} executing ${sql}`
  )
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createValidRequest(): Request {
  return new Request('http://localhost/api/encounters/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId: '550e8400-e29b-41d4-a716-446655440000',
      sections: [{ heading: 'Subjective', content: 'Patient reports headache' }],
    }),
  });
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 9: Database Errors Return Generic 500', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('error messages with sensitive content from getPatientPidFromUuid never leak in response body', async () => {
    await fc.assert(
      fc.asyncProperty(sensitiveErrorMessageArb, async (errorMessage) => {
        mockGetPatientPidFromUuid.mockRejectedValue(new Error(errorMessage));

        const response = await POST(createValidRequest());
        const body = await response.json();
        const responseText = JSON.stringify(body);

        // Response must be 500
        expect(response.status).toBe(500);
        // Response must have generic error code
        expect(body.code).toBe('INTERNAL_ERROR');
        // Response must have generic message
        expect(body.message).toBe('Unable to process request. Please try again.');
        // The sensitive error message must NOT appear in the response
        expect(responseText).not.toContain(errorMessage);
      }),
      { numRuns: 100 }
    );
  });

  it('error messages with sensitive content from createEncounterWithNote never leak in response body', async () => {
    await fc.assert(
      fc.asyncProperty(sensitiveErrorMessageArb, async (errorMessage) => {
        mockGetPatientPidFromUuid.mockResolvedValue(42);
        mockCreateEncounterWithNote.mockRejectedValue(new Error(errorMessage));

        const response = await POST(createValidRequest());
        const body = await response.json();
        const responseText = JSON.stringify(body);

        // Response must be 500
        expect(response.status).toBe(500);
        // Response must have generic error code
        expect(body.code).toBe('INTERNAL_ERROR');
        // Response must have generic message
        expect(body.message).toBe('Unable to process request. Please try again.');
        // The sensitive error message must NOT appear in the response
        expect(responseText).not.toContain(errorMessage);
      }),
      { numRuns: 100 }
    );
  });

  it('response body never contains database hostnames', async () => {
    await fc.assert(
      fc.asyncProperty(hostnameArb, async (hostname) => {
        mockGetPatientPidFromUuid.mockRejectedValue(
          new Error(`Connection timeout to ${hostname}:3306`)
        );

        const response = await POST(createValidRequest());
        const body = await response.json();
        const responseText = JSON.stringify(body);

        expect(response.status).toBe(500);
        expect(responseText).not.toContain(hostname);
      }),
      { numRuns: 100 }
    );
  });

  it('response body never contains credentials or secrets', async () => {
    await fc.assert(
      fc.asyncProperty(credentialArb, async (credential) => {
        mockGetPatientPidFromUuid.mockResolvedValue(42);
        mockCreateEncounterWithNote.mockRejectedValue(
          new Error(`Auth failed: ${credential}`)
        );

        const response = await POST(createValidRequest());
        const body = await response.json();
        const responseText = JSON.stringify(body);

        expect(response.status).toBe(500);
        expect(responseText).not.toContain(credential);
      }),
      { numRuns: 100 }
    );
  });

  it('response body never contains SQL statements', async () => {
    await fc.assert(
      fc.asyncProperty(sqlArb, async (sql) => {
        mockGetPatientPidFromUuid.mockResolvedValue(42);
        mockCreateEncounterWithNote.mockRejectedValue(
          new Error(`Query error: ${sql}`)
        );

        const response = await POST(createValidRequest());
        const body = await response.json();
        const responseText = JSON.stringify(body);

        expect(response.status).toBe(500);
        expect(responseText).not.toContain(sql);
      }),
      { numRuns: 100 }
    );
  });

  it('response body never contains stack traces or internal file paths', async () => {
    await fc.assert(
      fc.asyncProperty(stackTraceArb, async (stackTrace) => {
        mockGetPatientPidFromUuid.mockRejectedValue(
          new Error(`Unexpected error\n${stackTrace}`)
        );

        const response = await POST(createValidRequest());
        const body = await response.json();
        const responseText = JSON.stringify(body);

        expect(response.status).toBe(500);
        expect(responseText).not.toContain(stackTrace);
      }),
      { numRuns: 100 }
    );
  });

  it('response body never contains IP addresses or port numbers from errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(ipAddressArb, portArb),
        async ([ip, port]) => {
          mockGetPatientPidFromUuid.mockRejectedValue(
            new Error(`connect ECONNREFUSED ${ip}:${port}`)
          );

          const response = await POST(createValidRequest());
          const body = await response.json();
          const responseText = JSON.stringify(body);

          expect(response.status).toBe(500);
          expect(responseText).not.toContain(ip);
          expect(responseText).not.toContain(port);
        }
      ),
      { numRuns: 100 }
    );
  });
});
