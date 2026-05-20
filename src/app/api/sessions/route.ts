/**
 * POST /api/sessions — Create a new ambient documentation session.
 *
 * Accepts { patientId, patientContext } in the request body.
 * Validates the configured AWS region is us-east-1 or us-west-2 before creating.
 * Uses SessionManager to orchestrate domain, subscription, and session creation.
 *
 * Returns { sessionId, domainId, subscriptionId, status } on success.
 * Returns 400 if the region is unsupported or required fields are missing.
 *
 * @see Requirements 4.1, 4.2, 11.2, 11.3
 */

import { NextResponse } from 'next/server';
import { validateRegion, validateConfig } from '@/lib/config';
import { SessionManager } from '@/lib/session-manager';
import type { ConnectHealthClient } from '@/lib/session-manager';

/**
 * Stub Connect Health client for session creation.
 * In production, this would be replaced with the real AWS SDK client.
 */
function createConnectHealthClient(): ConnectHealthClient {
  // This is a placeholder — the real implementation uses @aws-sdk/client-connecthealth
  return {
    async listDomains() {
      return [];
    },
    async createDomain(domainName: string) {
      return { domainId: `domain-${Date.now()}`, domainName, status: 'ACTIVE' };
    },
    async createSubscription(domainId: string) {
      return { subscriptionId: `sub-${Date.now()}`, domainId, status: 'ACTIVE' };
    },
    async startMedicalScribeListeningSession(_params) {
      return { sessionId: `session-${Date.now()}`, streamUrl: '' };
    },
    async endSession(_sessionId: string) {
      // no-op
    },
  };
}

export async function POST(request: Request) {
  try {
    // Validate configuration (region check)
    const configResult = validateConfig();
    if (!configResult.valid) {
      return NextResponse.json(
        { code: 'CONFIG_ERROR', message: configResult.errors.join('; '), retryable: false },
        { status: 500 }
      );
    }

    const { config } = configResult;

    // Validate region is supported before session creation
    if (!validateRegion(config.aws.region)) {
      return NextResponse.json(
        {
          code: 'UNSUPPORTED_REGION',
          message: `Region "${config.aws.region}" is not supported. Supported regions: us-east-1, us-west-2`,
          retryable: false,
        },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json() as { patientId?: string; patientContext?: string };
    const { patientId, patientContext } = body;

    if (!patientId || !patientContext) {
      return NextResponse.json(
        {
          code: 'INVALID_REQUEST',
          message: 'Request body must include "patientId" and "patientContext"',
          retryable: false,
        },
        { status: 400 }
      );
    }

    // Create session via SessionManager
    const client = createConnectHealthClient();
    const sessionManager = SessionManager.fromConfig(config, client);
    const session = await sessionManager.startSession(patientId, patientContext);

    return NextResponse.json(
      {
        sessionId: session.sessionId,
        domainId: session.domainId,
        subscriptionId: session.subscriptionId,
        status: session.status,
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        code: 'SESSION_CREATION_FAILED',
        message,
        retryable: false,
      },
      { status: 500 }
    );
  }
}
