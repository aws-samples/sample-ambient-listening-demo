/**
 * GET /api/sessions/[id]/transcript-stream — Server-Sent Events for real-time transcripts.
 *
 * Opens an SSE connection that pushes transcript events as they arrive
 * from the Connect Health response stream.
 */

import { subscribeTranscripts, onSessionComplete, getSession } from '@/lib/stream-registry';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const session = getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`));

      // Subscribe to transcript events
      const unsubTranscript = subscribeTranscripts(sessionId, (event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'transcript', ...event })}\n\n`)
          );
        } catch {
          // Stream closed
        }
      });

      // Subscribe to session completion
      const unsubComplete = onSessionComplete(sessionId, () => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`));
          controller.close();
        } catch {
          // Already closed
        }
      });

      // Cleanup on abort
      _request.signal.addEventListener('abort', () => {
        unsubTranscript();
        unsubComplete();
        try { controller.close(); } catch { /* ignore */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
