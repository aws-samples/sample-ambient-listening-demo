/**
 * Unit tests for the S3 Output Retriever Module.
 *
 * Tests cover:
 * - S3 path construction
 * - Object type identification
 * - Clinical note parsing
 * - Single retrieval attempt
 * - Retry logic with 3 retries at 10-second intervals
 * - 60-second total timeout
 * - Partial results handling
 * - Error handling
 *
 * @see Requirements 7.1, 7.5, 7.6, 8.1, 8.4, 8.5
 */

import {
  buildOutputPrefix,
  identifyObjectType,
  parseClinicalNote,
  retrieveOutputsOnce,
  retrieveSessionOutputs,
  isOutputComplete,
  OutputRetriever,
  MAX_RETRIES,
  RETRY_INTERVAL_MS,
  TOTAL_TIMEOUT_MS,
  type S3ClientInterface,
  type OutputRetrieverParams,
  type SessionOutputs,
} from './output-retriever';

// ─── Mock S3 Client ──────────────────────────────────────────────────────────

class MockS3Client implements S3ClientInterface {
  private objects: Map<string, string> = new Map();
  public listObjectsCalls: { bucket: string; prefix: string }[] = [];
  public getObjectCalls: { bucket: string; key: string }[] = [];
  public listObjectsError?: Error;
  public getObjectError?: Error;

  setObjects(objects: Record<string, string>): void {
    this.objects = new Map(Object.entries(objects));
  }

  async listObjects(bucket: string, prefix: string): Promise<string[]> {
    this.listObjectsCalls.push({ bucket, prefix });
    if (this.listObjectsError) {
      throw this.listObjectsError;
    }
    return Array.from(this.objects.keys()).filter((key) => key.startsWith(prefix));
  }

  async getObject(bucket: string, key: string): Promise<string> {
    this.getObjectCalls.push({ bucket, key });
    if (this.getObjectError) {
      throw this.getObjectError;
    }
    const content = this.objects.get(key);
    if (!content) {
      throw new Error(`NoSuchKey: ${key}`);
    }
    return content;
  }
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const defaultParams: OutputRetrieverParams = {
  bucket: 'test-bucket',
  domainId: 'domain-123',
  subscriptionId: 'sub-456',
  sessionId: 'session-789',
};

const expectedPrefix =
  'health-agent-listening-session/domain-123/sub-456/session-789/post-stream-action/';

const sampleClinicalNote = JSON.stringify({
  sections: [
    { heading: 'Subjective', content: 'Patient reports headache for 3 days.' },
    { heading: 'Objective', content: 'BP 120/80, HR 72.' },
    { heading: 'Assessment', content: 'Tension headache.' },
    { heading: 'Plan', content: 'Ibuprofen 400mg PRN.' },
  ],
  evidenceMap: [
    {
      noteStatementId: 'stmt-1',
      noteStatement: 'Patient reports headache for 3 days.',
      sourceType: 'transcript',
      transcriptReference: {
        startTime: 10.5,
        endTime: 15.2,
        content: 'I have had a headache for about three days now.',
      },
    },
  ],
});

const sampleTranscript = 'CLINICIAN: How can I help you today?\nPATIENT: I have had a headache for about three days now.';

const sampleAVS = 'After Visit Summary\n\nYou visited your doctor today for a headache. Take ibuprofen as needed.';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('output-retriever', () => {
  describe('buildOutputPrefix', () => {
    it('constructs the correct S3 path prefix', () => {
      const prefix = buildOutputPrefix(defaultParams);
      expect(prefix).toBe(expectedPrefix);
    });

    it('handles different session parameters', () => {
      const params: OutputRetrieverParams = {
        bucket: 'other-bucket',
        domainId: 'dom-abc',
        subscriptionId: 'sub-def',
        sessionId: 'sess-ghi',
      };
      const prefix = buildOutputPrefix(params);
      expect(prefix).toBe(
        'health-agent-listening-session/dom-abc/sub-def/sess-ghi/post-stream-action/'
      );
    });
  });

  describe('identifyObjectType', () => {
    const prefix = expectedPrefix;

    it('identifies clinical note files', () => {
      expect(identifyObjectType(`${prefix}clinical-notes/note.json`, prefix)).toBe('clinical-note');
      expect(identifyObjectType(`${prefix}clinical-notes/summary.json`, prefix)).toBe('clinical-note');
    });

    it('identifies transcript files', () => {
      expect(identifyObjectType(`${prefix}transcript.json`, prefix)).toBe('transcript');
      expect(identifyObjectType(`${prefix}Transcript.txt`, prefix)).toBe('transcript');
    });

    it('identifies after-visit summary files', () => {
      expect(identifyObjectType(`${prefix}after-visit-summary.txt`, prefix)).toBe('avs');
      expect(identifyObjectType(`${prefix}AfterVisitSummary.json`, prefix)).toBe('avs');
      expect(identifyObjectType(`${prefix}avs.txt`, prefix)).toBe('avs');
    });

    it('returns unknown for unrecognized files', () => {
      expect(identifyObjectType(`${prefix}metadata.json`, prefix)).toBe('unknown');
      expect(identifyObjectType(`${prefix}config.yaml`, prefix)).toBe('unknown');
    });
  });

  describe('parseClinicalNote', () => {
    it('parses a clinical note in the expected format', () => {
      const note = parseClinicalNote(sampleClinicalNote);
      expect(note.sections).toHaveLength(4);
      expect(note.sections[0]!.heading).toBe('Subjective');
      expect(note.sections[0]!.content).toBe('Patient reports headache for 3 days.');
      expect(note.evidenceMap).toHaveLength(1);
      expect(note.evidenceMap[0]!.noteStatement).toBe('Patient reports headache for 3 days.');
      expect(note.evidenceMap[0]!.transcriptReference?.startTime).toBe(10.5);
    });

    it('parses Amazon Connect Health output format', () => {
      const connectHealthFormat = JSON.stringify({
        ClinicalDocumentation: {
          Sections: [
            {
              SectionName: 'Subjective',
              Summary: [
                {
                  SegmentId: 'seg-1',
                  SummarizedSegment: 'Patient has headache.',
                  SourceType: 'transcript',
                  TranscriptReference: {
                    StartTime: 5.0,
                    EndTime: 8.0,
                    Content: 'I have a headache.',
                  },
                },
              ],
            },
            {
              SectionName: 'Assessment',
              Summary: [
                {
                  SegmentId: 'seg-2',
                  SummarizedSegment: 'Tension headache.',
                  SourceType: 'patient_context',
                },
              ],
            },
          ],
        },
      });

      const note = parseClinicalNote(connectHealthFormat);
      expect(note.sections).toHaveLength(2);
      expect(note.sections[0]!.heading).toBe('Subjective');
      expect(note.sections[0]!.content).toBe('Patient has headache.');
      expect(note.sections[1]!.heading).toBe('Assessment');
      expect(note.evidenceMap).toHaveLength(2);
      expect(note.evidenceMap[0]!.transcriptReference?.startTime).toBe(5.0);
      expect(note.evidenceMap[1]!.sourceType).toBe('patient_context');
      expect(note.evidenceMap[1]!.transcriptReference).toBeUndefined();
    });

    it('throws on invalid JSON', () => {
      expect(() => parseClinicalNote('not json')).toThrow();
    });
  });

  describe('isOutputComplete', () => {
    it('returns true when all outputs are present', () => {
      const outputs: SessionOutputs = {
        clinicalNote: { sections: [], evidenceMap: [] },
        transcript: 'text',
        afterVisitSummary: 'summary',
      };
      expect(isOutputComplete(outputs)).toBe(true);
    });

    it('returns false when clinical note is missing', () => {
      const outputs: SessionOutputs = {
        transcript: 'text',
        afterVisitSummary: 'summary',
      };
      expect(isOutputComplete(outputs)).toBe(false);
    });

    it('returns false when transcript is missing', () => {
      const outputs: SessionOutputs = {
        clinicalNote: { sections: [], evidenceMap: [] },
        afterVisitSummary: 'summary',
      };
      expect(isOutputComplete(outputs)).toBe(false);
    });

    it('returns false when AVS is missing', () => {
      const outputs: SessionOutputs = {
        clinicalNote: { sections: [], evidenceMap: [] },
        transcript: 'text',
      };
      expect(isOutputComplete(outputs)).toBe(false);
    });

    it('returns false when all outputs are missing', () => {
      expect(isOutputComplete({})).toBe(false);
    });
  });

  describe('retrieveOutputsOnce', () => {
    let mockClient: MockS3Client;

    beforeEach(() => {
      mockClient = new MockS3Client();
    });

    it('retrieves all outputs when all files are present', async () => {
      mockClient.setObjects({
        [`${expectedPrefix}clinical-notes/note.json`]: sampleClinicalNote,
        [`${expectedPrefix}transcript.json`]: sampleTranscript,
        [`${expectedPrefix}after-visit-summary.txt`]: sampleAVS,
      });

      const outputs = await retrieveOutputsOnce(mockClient, defaultParams);

      expect(outputs.clinicalNote).toBeDefined();
      expect(outputs.clinicalNote!.sections).toHaveLength(4);
      expect(outputs.transcript).toBe(sampleTranscript);
      expect(outputs.afterVisitSummary).toBe(sampleAVS);
    });

    it('returns partial results when some files are missing', async () => {
      mockClient.setObjects({
        [`${expectedPrefix}transcript.json`]: sampleTranscript,
      });

      const outputs = await retrieveOutputsOnce(mockClient, defaultParams);

      expect(outputs.clinicalNote).toBeUndefined();
      expect(outputs.transcript).toBe(sampleTranscript);
      expect(outputs.afterVisitSummary).toBeUndefined();
    });

    it('returns empty outputs when no files are present', async () => {
      mockClient.setObjects({});

      const outputs = await retrieveOutputsOnce(mockClient, defaultParams);

      expect(outputs.clinicalNote).toBeUndefined();
      expect(outputs.transcript).toBeUndefined();
      expect(outputs.afterVisitSummary).toBeUndefined();
    });

    it('uses the correct bucket and prefix for listing', async () => {
      mockClient.setObjects({});

      await retrieveOutputsOnce(mockClient, defaultParams);

      expect(mockClient.listObjectsCalls).toHaveLength(1);
      expect(mockClient.listObjectsCalls[0]!.bucket).toBe('test-bucket');
      expect(mockClient.listObjectsCalls[0]!.prefix).toBe(expectedPrefix);
    });

    it('throws when listObjects fails', async () => {
      mockClient.listObjectsError = new Error('Access Denied');

      await expect(retrieveOutputsOnce(mockClient, defaultParams)).rejects.toThrow('Access Denied');
    });

    it('skips unknown file types', async () => {
      mockClient.setObjects({
        [`${expectedPrefix}metadata.json`]: '{}',
        [`${expectedPrefix}transcript.json`]: sampleTranscript,
      });

      const outputs = await retrieveOutputsOnce(mockClient, defaultParams);

      expect(outputs.transcript).toBe(sampleTranscript);
      expect(mockClient.getObjectCalls).toHaveLength(1);
      expect(mockClient.getObjectCalls[0]!.key).toBe(`${expectedPrefix}transcript.json`);
    });
  });

  describe('retrieveSessionOutputs (retry logic)', () => {
    let mockClient: MockS3Client;

    beforeEach(() => {
      mockClient = new MockS3Client();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns immediately when all outputs are available on first attempt', async () => {
      mockClient.setObjects({
        [`${expectedPrefix}clinical-notes/note.json`]: sampleClinicalNote,
        [`${expectedPrefix}transcript.json`]: sampleTranscript,
        [`${expectedPrefix}after-visit-summary.txt`]: sampleAVS,
      });

      const resultPromise = retrieveSessionOutputs(mockClient, defaultParams);
      const result = await resultPromise;

      expect(result.complete).toBe(true);
      expect(result.attemptNumber).toBe(1);
      expect(result.outputs.clinicalNote).toBeDefined();
      expect(result.outputs.transcript).toBeDefined();
      expect(result.outputs.afterVisitSummary).toBeDefined();
    });

    it('retries when outputs are incomplete', async () => {
      // First attempt: only transcript available
      // After retry: all available
      let callCount = 0;
      const originalListObjects = mockClient.listObjects.bind(mockClient);
      mockClient.listObjects = async (bucket: string, prefix: string) => {
        callCount++;
        if (callCount === 1) {
          mockClient.setObjects({
            [`${expectedPrefix}transcript.json`]: sampleTranscript,
          });
        } else {
          mockClient.setObjects({
            [`${expectedPrefix}clinical-notes/note.json`]: sampleClinicalNote,
            [`${expectedPrefix}transcript.json`]: sampleTranscript,
            [`${expectedPrefix}after-visit-summary.txt`]: sampleAVS,
          });
        }
        return originalListObjects(bucket, prefix);
      };

      const resultPromise = retrieveSessionOutputs(mockClient, defaultParams);

      // Advance past the retry interval
      await jest.advanceTimersByTimeAsync(RETRY_INTERVAL_MS);

      const result = await resultPromise;

      expect(result.complete).toBe(true);
      expect(result.attemptNumber).toBe(2);
    });

    it('returns partial results after all retries exhausted', async () => {
      // Only transcript is ever available
      mockClient.setObjects({
        [`${expectedPrefix}transcript.json`]: sampleTranscript,
      });

      const resultPromise = retrieveSessionOutputs(mockClient, defaultParams);

      // Advance through all retry intervals
      for (let i = 0; i < MAX_RETRIES; i++) {
        await jest.advanceTimersByTimeAsync(RETRY_INTERVAL_MS);
      }

      const result = await resultPromise;

      expect(result.complete).toBe(false);
      expect(result.outputs.transcript).toBe(sampleTranscript);
      expect(result.outputs.clinicalNote).toBeUndefined();
      expect(result.outputs.afterVisitSummary).toBeUndefined();
    });

    it('throws after all retries when every attempt errors', async () => {
      mockClient.listObjectsError = new Error('Network timeout');

      // Start the retrieval and catch the rejection
      let caughtError: Error | undefined;
      const resultPromise = retrieveSessionOutputs(mockClient, defaultParams).catch((err) => {
        caughtError = err;
      });

      // Need to advance timers for each retry interval between attempts
      // Attempt 0 runs immediately, then delay before attempts 1, 2, 3
      await jest.advanceTimersByTimeAsync(RETRY_INTERVAL_MS); // before attempt 1
      await jest.advanceTimersByTimeAsync(RETRY_INTERVAL_MS); // before attempt 2
      await jest.advanceTimersByTimeAsync(RETRY_INTERVAL_MS); // before attempt 3

      await resultPromise;

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toMatch(
        /Failed to retrieve session outputs after 4 attempts/
      );
      expect(caughtError!.message).toContain('Network timeout');
    });

    it('exports correct retry configuration constants', () => {
      expect(MAX_RETRIES).toBe(3);
      expect(RETRY_INTERVAL_MS).toBe(10_000);
      expect(TOTAL_TIMEOUT_MS).toBe(60_000);
    });
  });

  describe('OutputRetriever class', () => {
    let mockClient: MockS3Client;
    let retriever: OutputRetriever;

    beforeEach(() => {
      mockClient = new MockS3Client();
      retriever = new OutputRetriever(mockClient);
    });

    it('retrieve() delegates to retrieveSessionOutputs', async () => {
      mockClient.setObjects({
        [`${expectedPrefix}clinical-notes/note.json`]: sampleClinicalNote,
        [`${expectedPrefix}transcript.json`]: sampleTranscript,
        [`${expectedPrefix}after-visit-summary.txt`]: sampleAVS,
      });

      const result = await retriever.retrieve(defaultParams);

      expect(result.complete).toBe(true);
      expect(result.outputs.clinicalNote).toBeDefined();
    });

    it('retrieveOnce() delegates to retrieveOutputsOnce', async () => {
      mockClient.setObjects({
        [`${expectedPrefix}transcript.json`]: sampleTranscript,
      });

      const outputs = await retriever.retrieveOnce(defaultParams);

      expect(outputs.transcript).toBe(sampleTranscript);
      expect(outputs.clinicalNote).toBeUndefined();
    });
  });
});
