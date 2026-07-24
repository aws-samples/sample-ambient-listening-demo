/**
 * WebSocket server for browser-to-backend audio streaming.
 *
 * Bridges the browser WebSocket connection to the HTTP/2 AudioStreamer:
 * - Accepts audio chunks from the browser client
 * - Forwards them to the AudioStreamer (HTTP/2 stream to Amazon Connect Health)
 * - Forwards transcript events from the AudioStreamer back to the browser
 * - Handles connection drops and cleanup
 *
 * Message protocol:
 * - Client → Server: Binary data = audio chunks, JSON text = control messages
 * - Server → Client: JSON messages with type field:
 *   - { type: 'transcript', data: TranscriptSegment }
 *   - { type: 'error', data: AudioStreamerError }
 *   - { type: 'silence' }
 *   - { type: 'connected' }
 *   - { type: 'closed' }
 *
 * @see Requirements 5.1, 5.6
 */

import * as http from 'http';
import { URL } from 'url';

import { WebSocketServer, WebSocket } from 'ws';

import { AudioStreamer, AudioStreamerConfig, AudioStreamerError } from './audio-streamer';
import { SessionManager } from './session-manager';
import type { TranscriptSegment } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Control messages sent from the client to the server as JSON text.
 */
export interface ClientControlMessage {
  type: 'end_session' | 'ping';
}

/**
 * Messages sent from the server to the client.
 */
export type ServerMessage =
  | { type: 'transcript'; data: TranscriptSegment }
  | { type: 'error'; data: AudioStreamerError }
  | { type: 'silence' }
  | { type: 'connected' }
  | { type: 'closed' };

// ─── WebSocketAudioHandler ───────────────────────────────────────────────────

/**
 * Manages the lifecycle of a single WebSocket audio connection.
 *
 * For each connected client:
 * 1. Looks up the session by ID via the SessionManager
 * 2. Creates an AudioStreamer for the session's stream URL
 * 3. Forwards binary audio chunks from the WebSocket to the AudioStreamer
 * 4. Forwards transcript/error/silence events from the AudioStreamer to the WebSocket
 * 5. Cleans up resources when the WebSocket disconnects
 *
 * @see Requirements 5.1, 5.6
 */
export class WebSocketAudioHandler {
  private readonly ws: WebSocket;
  private readonly sessionId: string;
  private readonly sessionManager: SessionManager;
  private audioStreamer: AudioStreamer | null = null;
  private _isCleanedUp = false;

  constructor(ws: WebSocket, sessionId: string, sessionManager: SessionManager) {
    this.ws = ws;
    this.sessionId = sessionId;
    this.sessionManager = sessionManager;

    this.setupWebSocketListeners();
    this.initializeAudioStreamer();
  }

  /**
   * Whether this handler has been cleaned up (connection closed).
   */
  get isCleanedUp(): boolean {
    return this._isCleanedUp;
  }

  /**
   * Sets up WebSocket event listeners for the client connection.
   */
  private setupWebSocketListeners(): void {
    this.ws.on('message', (data: Buffer | string, isBinary: boolean) => {
      this.handleMessage(data, isBinary);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.handleDisconnect(code, reason.toString());
    });

    this.ws.on('error', (err: Error) => {
      this.handleWebSocketError(err);
    });

    // Respond to pings to keep the connection alive
    this.ws.on('pong', () => {
      // Connection is alive
    });
  }

  /**
   * Initializes the AudioStreamer for this session.
   * Looks up the session to get the stream URL, then connects.
   */
  private async initializeAudioStreamer(): Promise<void> {
    const session = this.sessionManager.getSession(this.sessionId);

    if (!session) {
      this.sendMessage({ type: 'error', data: {
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found',
        retryable: false,
      }});
      this.ws.close(4004, 'Session not found');
      return;
    }

    if (session.status !== 'active') {
      this.sendMessage({ type: 'error', data: {
        code: 'SESSION_NOT_ACTIVE',
        message: `Session is not active (current status: ${session.status})`,
        retryable: false,
      }});
      this.ws.close(4003, 'Session not active');
      return;
    }

    // Build the stream URL from the session's output URI and session ID
    // The actual stream URL would come from the StartMedicalScribeListeningSession response
    // For now, we construct the AudioStreamer config from session data
    const streamerConfig: AudioStreamerConfig = {
      streamUrl: session.outputS3Uri, // In production, this would be the HTTP/2 stream URL
      sessionId: session.sessionId,
    };

    this.audioStreamer = new AudioStreamer(streamerConfig);
    this.setupAudioStreamerListeners();

    try {
      await this.audioStreamer.connect();
      this.sendMessage({ type: 'connected' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.sendMessage({ type: 'error', data: {
        code: 'STREAMER_CONNECT_FAILED',
        message: `Failed to connect audio streamer: ${errorMessage}`,
        retryable: true,
      }});
      this.cleanup();
    }
  }

  /**
   * Sets up event listeners on the AudioStreamer to forward events to the WebSocket client.
   */
  private setupAudioStreamerListeners(): void {
    if (!this.audioStreamer) return;

    this.audioStreamer.on('transcript', (segment: TranscriptSegment) => {
      this.sendMessage({ type: 'transcript', data: segment });
    });

    this.audioStreamer.on('error', (error: AudioStreamerError) => {
      this.sendMessage({ type: 'error', data: error });

      // If the error is not retryable, close the WebSocket
      if (!error.retryable) {
        this.ws.close(4500, error.message);
        this.cleanup();
      }
    });

    this.audioStreamer.on('silence', () => {
      this.sendMessage({ type: 'silence' });
    });

    this.audioStreamer.on('closed', () => {
      this.sendMessage({ type: 'closed' });
    });
  }

  /**
   * Handles incoming WebSocket messages.
   * Binary data is treated as audio chunks; text data is parsed as JSON control messages.
   */
  private handleMessage(data: Buffer | string, isBinary: boolean): void {
    if (this._isCleanedUp) return;

    if (isBinary) {
      // Binary data = audio chunk
      this.handleAudioChunk(data as Buffer);
    } else {
      // Text data = control message
      this.handleControlMessage(data.toString());
    }
  }

  /**
   * Forwards a binary audio chunk to the AudioStreamer.
   */
  private handleAudioChunk(chunk: Buffer): void {
    if (!this.audioStreamer || !this.audioStreamer.isConnected) {
      return;
    }

    try {
      this.audioStreamer.sendAudioChunk(chunk);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.sendMessage({ type: 'error', data: {
        code: 'AUDIO_SEND_FAILED',
        message: `Failed to send audio chunk: ${errorMessage}`,
        retryable: true,
      }});
    }
  }

  /**
   * Handles a JSON control message from the client.
   */
  private handleControlMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as ClientControlMessage;

      switch (message.type) {
        case 'end_session':
          this.handleEndSession();
          break;
        case 'ping':
          // No-op, just keeps the connection alive
          break;
        default:
          // Unknown control message type — ignore
          break;
      }
    } catch {
      // Malformed JSON — ignore
    }
  }

  /**
   * Handles the end_session control message by ending the audio stream.
   */
  private async handleEndSession(): Promise<void> {
    if (!this.audioStreamer) return;

    try {
      await this.audioStreamer.endStream();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.sendMessage({ type: 'error', data: {
        code: 'END_STREAM_FAILED',
        message: `Failed to end stream: ${errorMessage}`,
        retryable: false,
      }});
    } finally {
      this.cleanup();
    }
  }

  /**
   * Handles WebSocket disconnection (client dropped or closed).
   *
   * @see Requirements 5.6
   */
  private handleDisconnect(_code: number, _reason: string): void {
    this.cleanup();
  }

  /**
   * Handles WebSocket errors.
   */
  private handleWebSocketError(_err: Error): void {
    this.cleanup();
  }

  /**
   * Sends a JSON message to the WebSocket client.
   * Silently ignores send failures if the connection is already closed.
   */
  private sendMessage(message: ServerMessage): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch {
      // Connection may have closed between the readyState check and send
    }
  }

  /**
   * Cleans up all resources: destroys the AudioStreamer and marks the handler as done.
   */
  private cleanup(): void {
    if (this._isCleanedUp) return;
    this._isCleanedUp = true;

    if (this.audioStreamer) {
      this.audioStreamer.destroy();
      this.audioStreamer.removeAllListeners();
      this.audioStreamer = null;
    }
  }
}

// ─── WebSocket Server Factory ────────────────────────────────────────────────

/**
 * Creates a WebSocket server attached to the given HTTP server.
 *
 * The WebSocket server handles connections on the path `/ws/audio/:sessionId`.
 * Each connection is managed by a WebSocketAudioHandler instance.
 *
 * Uses `noServer: true` mode so we can manually handle the HTTP upgrade
 * and route based on the request path.
 *
 * @param server - The HTTP server to attach the WebSocket server to
 * @param sessionManager - The SessionManager instance for looking up sessions
 * @returns The configured WebSocketServer instance
 *
 * @see Requirements 5.1, 5.6
 */
export function createWebSocketServer(
  server: http.Server,
  sessionManager: SessionManager
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Track active handlers for cleanup
  const activeHandlers = new Map<WebSocket, WebSocketAudioHandler>();

  // Handle upgrade requests manually to support path-based routing
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Match /ws/audio/:sessionId pattern
    const match = pathname.match(/^\/ws\/audio\/([^/]+)$/);

    if (!match) {
      // Not a recognized WebSocket path — reject the upgrade
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionId = match[1];

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, sessionId);
    });
  });

  // Handle new WebSocket connections
  wss.on('connection', (ws: WebSocket, _request: http.IncomingMessage, sessionId?: string) => {
    if (!sessionId) {
      ws.close(4000, 'Missing session ID');
      return;
    }

    const handler = new WebSocketAudioHandler(ws, sessionId, sessionManager);
    activeHandlers.set(ws, handler);

    ws.on('close', () => {
      activeHandlers.delete(ws);
    });
  });

  return wss;
}
