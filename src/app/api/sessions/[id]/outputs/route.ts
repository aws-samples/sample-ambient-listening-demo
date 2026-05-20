/**
 * GET /api/sessions/[id]/outputs — Retrieve session outputs from S3.
 *
 * Uses OutputRetriever to get the clinical note, transcript, and after-visit summary
 * from the S3 output bucket.
 *
 * Returns { clinicalNote, transcript, afterVisitSummary, complete } on success.
 * Returns partial results if not all outputs are available yet.
 * Returns 400 if required query parameters are missing.
 *
 * Query parameters:
 * - domainId: The domain ID for the session
 * - subscriptionId: The subscription ID for the session
 *
 * @see Requirements 7.1, 14.1
 */

import { NextResponse } from 'next/server';
import { validateConfig } from '@/lib/config';
import { OutputRetriever } from '@/lib/output-retriever';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;

    // Parse query parameters for domainId and subscriptionId
    const { searchParams } = new URL(request.url);
    const domainId = searchParams.get('domainId');
    const subscriptionId = searchParams.get('subscriptionId');

    if (!domainId || !subscriptionId) {
      return NextResponse.json(
        {
          code: 'INVALID_REQUEST',
          message: 'Query parameters "domainId" and "subscriptionId" are required',
          retryable: false,
        },
        { status: 400 }
      );
    }

    // Validate configuration
    const configResult = validateConfig();
    if (!configResult.valid) {
      return NextResponse.json(
        { code: 'CONFIG_ERROR', message: configResult.errors.join('; '), retryable: false },
        { status: 500 }
      );
    }

    const { config } = configResult;

    // Retrieve outputs from S3
    const retriever = OutputRetriever.create(config.aws.region);
    const result = await retriever.retrieve({
      bucket: config.aws.s3OutputBucket,
      domainId,
      subscriptionId,
      sessionId,
    });

    return NextResponse.json({
      clinicalNote: result.outputs.clinicalNote ?? null,
      transcript: result.outputs.transcript ?? null,
      afterVisitSummary: result.outputs.afterVisitSummary ?? null,
      complete: result.complete,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        code: 'OUTPUT_RETRIEVAL_FAILED',
        message,
        retryable: true,
        maxRetries: 3,
      },
      { status: 500 }
    );
  }
}
