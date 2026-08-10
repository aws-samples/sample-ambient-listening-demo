/**
 * In-memory registry for active Connect Health streaming sessions.
 *
 * Bridges the audio input stream (from browser) with the Connect Health SDK stream,
 * and publishes transcript events back to the SSE endpoint.
 *
 * Architecture:
 * - Browser sends audio chunks via POST /api/sessions/[id]/audio-stream
 * - This registry holds the async generator that feeds the SDK's inputStream
 * - The SDK's responseStream yields transcript events
 * - Transcript events are pushed to subscribers (SSE connections)
 */

import { EventEmitter } from 'events';

export interface TranscriptEvent {
  id: string;
  content: string;
  channelId: string;
  startTime: number;
  endTime: number;
  isPartial: boolean;
}

interface ActiveSession {
  domainId: string;
  subscriptionId: string;
  patientContext: string;
  audioQueue: Buffer[];
  audioResolve: (() => void) | null;
  ended: boolean;
  emitter: EventEmitter;
}

// Global registry of active streaming sessions
const sessions = new Map<string, ActiveSession>();

/**
 * Registers a new streaming session.
 */
export function registerSession(
  sessionId: string,
  domainId: string,
  subscriptionId: string,
  patientContext: string
): void {
  sessions.set(sessionId, {
    domainId,
    subscriptionId,
    patientContext,
    audioQueue: [],
    audioResolve: null,
    ended: false,
    emitter: new EventEmitter(),
  });
}

/**
 * Gets a registered session.
 */
export function getSession(sessionId: string): ActiveSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Pushes an audio chunk into the session's queue.
 * Wakes up the async generator if it's waiting.
 */
export function pushAudioChunk(sessionId: string, chunk: Buffer): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.ended) return false;

  session.audioQueue.push(chunk);
  if (session.audioResolve) {
    session.audioResolve();
    session.audioResolve = null;
  }
  return true;
}

/**
 * Signals that the audio stream has ended (END_OF_SESSION).
 */
export function endAudioStream(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.ended = true;
  if (session.audioResolve) {
    session.audioResolve();
    session.audioResolve = null;
  }
}

/**
 * Publishes a transcript event to all subscribers of a session.
 */
export function publishTranscript(sessionId: string, event: TranscriptEvent): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.emitter.emit('transcript', event);
}

/**
 * Subscribes to transcript events for a session.
 */
export function subscribeTranscripts(
  sessionId: string,
  callback: (event: TranscriptEvent) => void
): () => void {
  const session = sessions.get(sessionId);
  if (!session) return () => {};

  session.emitter.on('transcript', callback);
  return () => {
    session.emitter.off('transcript', callback);
  };
}

/**
 * Publishes a session completion event.
 */
export function publishSessionComplete(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.emitter.emit('complete');
}

/**
 * Subscribes to session completion.
 */
export function onSessionComplete(sessionId: string, callback: () => void): () => void {
  const session = sessions.get(sessionId);
  if (!session) return () => {};

  session.emitter.on('complete', callback);
  return () => {
    session.emitter.off('complete', callback);
  };
}

/**
 * Creates an async iterable that yields audio chunks as they arrive.
 * Used as the inputStream for StartMedicalScribeListeningSession.
 */
export function createAudioAsyncIterable(sessionId: string): AsyncIterable<Buffer> {
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      async *[Symbol.asyncIterator]() {
        // Empty
      },
    };
  }

  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        // If there are queued chunks, yield them
        while (session.audioQueue.length > 0) {
          const chunk = session.audioQueue.shift()!;
          yield chunk;
        }

        // If ended, stop
        if (session.ended) {
          return;
        }

        // Wait for more audio
        await new Promise<void>((resolve) => {
          session.audioResolve = resolve;
        });
      }
    },
  };
}

/**
 * Removes a session from the registry.
 */
export function removeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.emitter.removeAllListeners();
    sessions.delete(sessionId);
  }
}
