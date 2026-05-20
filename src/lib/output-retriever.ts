/**
 * S3 Output Retriever Module for the Ambient Clinical Documentation Demo.
 *
 * Polls S3 at the known output path to retrieve:
 * - Clinical note (with evidence mapping) from `clinical-notes/` subfolder
 * - Transcript
 * - After-visit summary
 *
 * Implements retry logic: 3 retries at 10-second intervals, 60-second total timeout.
 *
 * @see Requirements 7.1, 7.5, 7.6, 8.1, 8.4, 8.5
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import type { ClinicalNote, SOAPSection, EvidenceMapping } from '@/types';

// ─── Configuration Constants ─────────────────────────────────────────────────

/** Maximum number of retry attempts for output retrieval. */
export const MAX_RETRIES = 3;

/** Interval between retry attempts in milliseconds (10 seconds). */
export const RETRY_INTERVAL_MS = 10_000;

/** Total timeout for output retrieval in milliseconds (60 seconds). */
export const TOTAL_TIMEOUT_MS = 60_000;

/** S3 path prefix for health agent listening session outputs. */
export const S3_OUTPUT_PATH_PREFIX = 'health-agent-listening-session';

/** Subfolder containing clinical notes within the post-stream-action output. */
export const CLINICAL_NOTES_SUBFOLDER = 'clinical-notes/';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Parameters required to retrieve session outputs from S3.
 */
export interface OutputRetrieverParams {
  bucket: string;
  domainId: string;
  subscriptionId: string;
  sessionId: string;
}

/**
 * The structured result of output retrieval.
 * Fields may be undefined if the corresponding file is not yet available.
 */
export interface SessionOutputs {
  clinicalNote?: ClinicalNote;
  transcript?: string;
  afterVisitSummary?: string;
}

/**
 * Result of a retrieval attempt, including metadata about the attempt.
 */
export interface RetrievalResult {
  outputs: SessionOutputs;
  complete: boolean;
  attemptNumber: number;
  elapsedMs: number;
}

/**
 * Interface for the S3 client operations used by the output retriever.
 * This abstraction allows for testing with mock implementations.
 */
export interface S3ClientInterface {
  listObjects(bucket: string, prefix: string): Promise<string[]>;
  getObject(bucket: string, key: string): Promise<string>;
}

// ─── Default S3 Client Implementation ────────────────────────────────────────

/**
 * Default S3 client implementation using @aws-sdk/client-s3.
 */
export class DefaultS3Client implements S3ClientInterface {
  private readonly client: S3Client;

  constructor(region: string) {
    this.client = new S3Client({ region });
  }

  async listObjects(bucket: string, prefix: string): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    });

    const response = await this.client.send(command);
    return (response.Contents || [])
      .map((obj) => obj.Key)
      .filter((key): key is string => key !== undefined);
  }

  async getObject(bucket: string, key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`Empty response body for s3://${bucket}/${key}`);
    }

    return response.Body.transformToString('utf-8');
  }
}

// ─── Output Retriever ────────────────────────────────────────────────────────

/**
 * Constructs the S3 path prefix for a session's post-stream-action outputs.
 *
 * Path format: `health-agent-listening-session/{domainId}/{subscriptionId}/{sessionId}/post-stream-action/`
 */
export function buildOutputPrefix(params: OutputRetrieverParams): string {
  return `${S3_OUTPUT_PATH_PREFIX}/${params.domainId}/${params.subscriptionId}/${params.sessionId}/post-stream-action/`;
}

/**
 * Parses a clinical note JSON file into the ClinicalNote structure.
 * Handles the expected output format from Amazon Connect Health.
 */
export function parseClinicalNote(content: string): ClinicalNote {
  const parsed = JSON.parse(content);

  // Handle the case where the content is already in our expected format
  if (parsed.sections && Array.isArray(parsed.sections)) {
    return {
      sections: parsed.sections as SOAPSection[],
      evidenceMap: (parsed.evidenceMap || []) as EvidenceMapping[],
    };
  }

  // Handle the Amazon Connect Health output format
  // The service may output sections under different keys
  const sections: SOAPSection[] = [];
  const evidenceMap: EvidenceMapping[] = [];

  const soapHeadings: SOAPSection['heading'][] = [
    'Subjective',
    'Objective',
    'Assessment',
    'Plan',
  ];

  if (parsed.ClinicalDocumentation?.Sections) {
    for (const section of parsed.ClinicalDocumentation.Sections) {
      const heading = soapHeadings.find(
        (h) => h.toLowerCase() === section.SectionName?.toLowerCase()
      );
      if (heading) {
        const content = Array.isArray(section.Summary)
          ? section.Summary.map((s: { SummarizedSegment: string }) => s.SummarizedSegment).join('\n')
          : section.Summary || '';
        sections.push({ heading, content });

        // Extract evidence mappings from summarized segments
        if (Array.isArray(section.Summary)) {
          for (const segment of section.Summary) {
            if (segment.SummarizedSegment) {
              const mapping: EvidenceMapping = {
                noteStatementId: segment.SegmentId || `${heading}-${evidenceMap.length}`,
                noteStatement: segment.SummarizedSegment,
                sourceType: segment.SourceType === 'patient_context' ? 'patient_context' : 'transcript',
              };

              if (segment.TranscriptReference) {
                mapping.transcriptReference = {
                  startTime: segment.TranscriptReference.StartTime || 0,
                  endTime: segment.TranscriptReference.EndTime || 0,
                  content: segment.TranscriptReference.Content || '',
                };
              }

              evidenceMap.push(mapping);
            }
          }
        }
      }
    }
  }

  return { sections, evidenceMap };
}

/**
 * Identifies the type of an S3 object based on its key.
 */
export function identifyObjectType(
  key: string,
  prefix: string
): 'clinical-note' | 'transcript' | 'avs' | 'unknown' {
  const relativePath = key.slice(prefix.length);

  if (relativePath.startsWith(CLINICAL_NOTES_SUBFOLDER)) {
    return 'clinical-note';
  }

  const lowerPath = relativePath.toLowerCase();
  if (lowerPath.includes('transcript')) {
    return 'transcript';
  }

  if (
    lowerPath.includes('after-visit-summary') ||
    lowerPath.includes('aftervisitsummary') ||
    lowerPath.includes('avs')
  ) {
    return 'avs';
  }

  return 'unknown';
}

/**
 * Utility to wait for a specified duration.
 * Accepts an optional AbortSignal to allow cancellation.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      }, { once: true });
    }
  });
}

/**
 * Retrieves session outputs from S3 in a single attempt.
 * Lists objects at the output prefix and retrieves clinical note, transcript, and AVS.
 *
 * @param s3Client - The S3 client to use for operations
 * @param params - Session parameters for constructing the S3 path
 * @returns The retrieved session outputs (some fields may be undefined if not yet available)
 */
export async function retrieveOutputsOnce(
  s3Client: S3ClientInterface,
  params: OutputRetrieverParams
): Promise<SessionOutputs> {
  const prefix = buildOutputPrefix(params);
  const keys = await s3Client.listObjects(params.bucket, prefix);

  const outputs: SessionOutputs = {};

  for (const key of keys) {
    const objectType = identifyObjectType(key, prefix);

    switch (objectType) {
      case 'clinical-note': {
        if (!outputs.clinicalNote) {
          const content = await s3Client.getObject(params.bucket, key);
          outputs.clinicalNote = parseClinicalNote(content);
        }
        break;
      }
      case 'transcript': {
        if (!outputs.transcript) {
          outputs.transcript = await s3Client.getObject(params.bucket, key);
        }
        break;
      }
      case 'avs': {
        if (!outputs.afterVisitSummary) {
          outputs.afterVisitSummary = await s3Client.getObject(params.bucket, key);
        }
        break;
      }
      default:
        // Skip unknown file types
        break;
    }
  }

  return outputs;
}

/**
 * Checks whether the session outputs are complete (all three files retrieved).
 */
export function isOutputComplete(outputs: SessionOutputs): boolean {
  return (
    outputs.clinicalNote !== undefined &&
    outputs.transcript !== undefined &&
    outputs.afterVisitSummary !== undefined
  );
}

/**
 * Retrieves session outputs from S3 with retry logic.
 *
 * Polls S3 at the known output path:
 * `s3://{bucket}/health-agent-listening-session/{domainId}/{subscriptionId}/{sessionId}/post-stream-action/`
 *
 * Retry strategy:
 * - Up to 3 retries at 10-second intervals
 * - 60-second total timeout
 * - Returns partial results if some files are available but not all
 * - Stops retrying early if all outputs are retrieved
 *
 * @param s3Client - The S3 client to use for operations
 * @param params - Session parameters for constructing the S3 path
 * @returns The retrieval result including outputs, completeness status, and timing
 * @throws Error if the total timeout is exceeded or all retries are exhausted without any data
 *
 * @see Requirements 7.1, 7.5, 7.6, 8.1, 8.4, 8.5
 */
export async function retrieveSessionOutputs(
  s3Client: S3ClientInterface,
  params: OutputRetrieverParams
): Promise<RetrievalResult> {
  const startTime = Date.now();
  let lastOutputs: SessionOutputs = {};
  let attemptNumber = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    attemptNumber = attempt + 1;

    // Check total timeout before attempting
    const elapsed = Date.now() - startTime;
    if (elapsed >= TOTAL_TIMEOUT_MS) {
      break;
    }

    // Wait before retry (not before first attempt)
    if (attempt > 0) {
      const remainingTime = TOTAL_TIMEOUT_MS - (Date.now() - startTime);
      const waitTime = Math.min(RETRY_INTERVAL_MS, remainingTime);

      if (waitTime <= 0) {
        break;
      }

      await delay(waitTime);
    }

    // Check timeout again after waiting
    if (Date.now() - startTime >= TOTAL_TIMEOUT_MS) {
      break;
    }

    try {
      lastOutputs = await retrieveOutputsOnce(s3Client, params);

      // If all outputs are available, return immediately
      if (isOutputComplete(lastOutputs)) {
        return {
          outputs: lastOutputs,
          complete: true,
          attemptNumber,
          elapsedMs: Date.now() - startTime,
        };
      }
    } catch (error) {
      // On error, continue retrying unless we've exhausted attempts
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Failed to retrieve session outputs after ${MAX_RETRIES + 1} attempts: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      // Continue to next retry
    }
  }

  // Return partial results after all retries exhausted or timeout
  const elapsedMs = Date.now() - startTime;
  const complete = isOutputComplete(lastOutputs);

  return {
    outputs: lastOutputs,
    complete,
    attemptNumber,
    elapsedMs,
  };
}

// ─── Output Retriever Class ──────────────────────────────────────────────────

/**
 * High-level output retriever that manages S3 client creation and provides
 * a convenient interface for retrieving session outputs.
 *
 * @see Requirements 7.1, 7.5, 7.6, 8.1, 8.4, 8.5
 */
export class OutputRetriever {
  private readonly s3Client: S3ClientInterface;

  constructor(s3Client: S3ClientInterface) {
    this.s3Client = s3Client;
  }

  /**
   * Creates an OutputRetriever with the default S3 client for the given region.
   */
  static create(region: string): OutputRetriever {
    return new OutputRetriever(new DefaultS3Client(region));
  }

  /**
   * Retrieves session outputs with retry logic.
   *
   * @param params - Session parameters (bucket, domainId, subscriptionId, sessionId)
   * @returns The retrieval result
   */
  async retrieve(params: OutputRetrieverParams): Promise<RetrievalResult> {
    return retrieveSessionOutputs(this.s3Client, params);
  }

  /**
   * Retrieves session outputs once without retry logic.
   * Useful for manual retry scenarios where the caller controls retry timing.
   *
   * @param params - Session parameters (bucket, domainId, subscriptionId, sessionId)
   * @returns The session outputs (some fields may be undefined)
   */
  async retrieveOnce(params: OutputRetrieverParams): Promise<SessionOutputs> {
    return retrieveOutputsOnce(this.s3Client, params);
  }
}
