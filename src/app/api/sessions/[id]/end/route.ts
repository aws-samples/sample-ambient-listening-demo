/**
 * POST /api/sessions/[id]/end — End an active ambient session.
 *
 * Since the session state is managed client-side and the actual END_OF_SESSION
 * control event is sent via the AudioStreamer through the WebSocket/HTTP2 stream,
 * this endpoint simply acknowledges the session end.
 *
 * In a production system, this would verify the session exists via
 * GetMedicalScribeListeningSession and confirm it's in a terminal state.
 *
 * Returns { status: 'ended', endedAt } on success.
 *
 * @see Requirements 4.4
 */

import { NextResponse } from 'next/server';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        {
          code: 'INVALID_REQUEST',
          message: 'Session ID is required',
          retryable: false,
        },
        { status: 400 }
      );
    }

    // The END_OF_SESSION control event is sent through the audio stream
    // by the client-side AudioStreamer. This endpoint acknowledges the end
    // and returns the timestamp for the UI to display.
    console.log(`[Sessions API] Session ended`);

    return NextResponse.json({
      status: 'ended',
      sessionId,
      endedAt: new Date().toISOString(),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'Unknown';
    console.error(`[Sessions API] Error ending session:`, errorName);

    return NextResponse.json(
      { code: 'SESSION_END_FAILED', message: 'Failed to end session', retryable: false },
      { status: 500 }
    );
  }
}
