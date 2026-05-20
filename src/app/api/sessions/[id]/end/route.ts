/**
 * POST /api/sessions/[id]/end — End an active ambient session.
 *
 * Ends the session via SessionManager, which sends the END_OF_SESSION control event
 * to the Amazon Connect Health service.
 *
 * Returns { status: 'ended', endedAt } on success.
 * Returns 404 if the session is not found.
 * Returns 400 if the session is not in a valid state to end.
 *
 * @see Requirements 4.4
 */

import { NextResponse } from 'next/server';
import { validateConfig } from '@/lib/config';
import { SessionManager } from '@/lib/session-manager';
import type { ConnectHealthClient } from '@/lib/session-manager';

/**
 * Stub Connect Health client for ending sessions.
 * In production, this would be replaced with the real AWS SDK client.
 */
function createConnectHealthClient(): ConnectHealthClient {
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
      // Sends END_OF_SESSION control event
    },
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;

    // Validate configuration
    const configResult = validateConfig();
    if (!configResult.valid) {
      return NextResponse.json(
        { code: 'CONFIG_ERROR', message: configResult.errors.join('; '), retryable: false },
        { status: 500 }
      );
    }

    const { config } = configResult;

    const client = createConnectHealthClient();
    const sessionManager = SessionManager.fromConfig(config, client);

    // Attempt to end the session
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        {
          code: 'SESSION_NOT_FOUND',
          message: `Session "${sessionId}" not found`,
          retryable: false,
        },
        { status: 404 }
      );
    }

    const endedSession = await sessionManager.endSession(sessionId);

    return NextResponse.json({
      status: 'ended',
      endedAt: endedSession.endedAt?.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('not found') || message.includes('Session not found')) {
      return NextResponse.json(
        { code: 'SESSION_NOT_FOUND', message, retryable: false },
        { status: 404 }
      );
    }

    if (message.includes('Cannot end session')) {
      return NextResponse.json(
        { code: 'INVALID_SESSION_STATE', message, retryable: false },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { code: 'SESSION_END_FAILED', message, retryable: false },
      { status: 500 }
    );
  }
}
