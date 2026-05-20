/**
 * HTTP/2 audio streaming module for Amazon Connect Health.
 *
 * Handles the HTTP/2 connection to Amazon Connect Health for streaming audio data:
 * - Uses Node.js native `http2` module
 * - Enforces TLS 1.2+ on the connection
 * - Publishes MedicalScribeAudioEvent messages containing PCM audio chunks
 * - Sends SessionControlEvent (END_OF_SESSION) when the session ends
 * - Detects 30-second silence (no data received) and notifies the caller
 * - Handles stream drops/disconnections
 *
 * Audio format: PCM 16-bit, 16000 Hz minimum sample rate
 *
 * @see Requirements 5.1, 5.2, 5.6, 13.4
 */

import { EventEmitter } from 'events';
import * as http2 from 'http2';
import * as tls from 'tls';

import type { TranscriptSegment } from '@/types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Silence detection timeout in milliseconds (30 seconds). */
const SILENCE_TIMEOUT_MS = 30_000;

/** Minimum TLS version required for the HTTP/2 connection. */
const MIN_TLS_VERSION = 'TLSv1.2';

// ─── Event Types ─────────────────────────────────────────────────────────────

/**
 * Events emitted by the AudioStreamer.
 */
export interface AudioStreamerEvents {
  /** Emitted when a transcript event is received from the service. */
  transcript: (segment: TranscriptSegment) => void;
  /** Emitted on connection errors or stream drops. */
  error: (error: AudioStreamerError) => void;
  /** Emitted when no data is received for 30 seconds. */
  silence: () => void;
  /** Emitted when the stream is successfully connected. */
  connected: () => void;
  /** Emitted when the stream is closed (either normally or due to error). */
  closed: () => void;
}

/**
 * Error details for audio streaming failures.
 */
export interface AudioStreamerError {
  code: string;
  message: string;
  retryable: boolean;
}

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Configuration for the AudioStreamer.
 */
export interface AudioStreamerConfig {
  /** The stream URL from StartMedicalScribeListeningSession response. */
  streamUrl: string;
  /** Session ID for the current session. */
  sessionId: string;
}

// ─── MedicalScribeAudioEvent ─────────────────────────────────────────────────

/**
 * Represents a MedicalScribeAudioEvent message sent to the service.
 * Contains PCM audio data as a binary payload.
 */
interface MedicalScribeAudioEvent {
  audioChunk: Buffer;
}

/**
 * Represents a SessionControlEvent sent to end the session.
 */
interface SessionControlEvent {
  type: 'END_OF_SESSION';
}

// ─── AudioStreamer Class ─────────────────────────────────────────────────────

/**
 * Manages HTTP/2 audio streaming to Amazon Connect Health.
 *
 * Uses the EventEmitter pattern to notify callers of:
 * - Transcript events received from the service
 * - Connection errors and stream drops
 * - Silence detection (30 seconds without data)
 *
 * Usage:
 * ```typescript
 * const streamer = new AudioStreamer({ streamUrl, sessionId });
 * streamer.on('transcript', (segment) => { ... });
 * streamer.on('error', (err) => { ... });
 * streamer.on('silence', () => { ... });
 * await streamer.connect();
 * streamer.sendAudioChunk(pcmBuffer);
 * await streamer.endStream();
 * ```
 *
 * @see Requirements 5.1, 5.2, 5.6, 13.4
 */
export class AudioStreamer extends EventEmitter {
  private readonly config: AudioStreamerConfig;
  private session: http2.ClientHttp2Session | null = null;
  private stream: http2.ClientHttp2Stream | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _isConnected = false;
  private _isClosed = false;
  private responseBuffer = '';

  constructor(config: AudioStreamerConfig) {
    super();
    this.config = config;
  }

  /**
   * Whether the streamer is currently connected and ready to send audio.
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Whether the streamer has been closed (either normally or due to error).
   */
  get isClosed(): boolean {
    return this._isClosed;
  }

  /**
   * Establishes the HTTP/2 connection to the stream URL with TLS 1.2+.
   *
   * @throws Error if the connection cannot be established
   * @see Requirements 5.1, 13.4
   */
  async connect(): Promise<void> {
    if (this._isConnected) {
      return;
    }

    if (this._isClosed) {
      throw new Error('AudioStreamer has been closed and cannot be reconnected.');
    }

    const url = new URL(this.config.streamUrl);

    return new Promise<void>((resolve, reject) => {
      const connectOptions: http2.SecureClientSessionOptions = {
        // Enforce TLS 1.2+ as required by Requirement 13.4
        minVersion: MIN_TLS_VERSION as tls.SecureVersion,
        // Allow the default CA certificates
        rejectUnauthorized: true,
      };

      this.session = http2.connect(
        `https://${url.host}`,
        connectOptions
      );

      this.session.on('error', (err: Error) => {
        this.handleConnectionError(err);
        if (!this._isConnected) {
          reject(err);
        }
      });

      this.session.on('close', () => {
        if (this._isConnected && !this._isClosed) {
          // Unexpected close — stream drop
          this.handleStreamDrop();
        }
      });

      this.session.on('goaway', () => {
        if (!this._isClosed) {
          this.handleStreamDrop();
        }
      });

      this.session.on('connect', () => {
        try {
          this.openStream(url);
          this._isConnected = true;
          this.startSilenceTimer();
          this.emit('connected');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * Sends a PCM audio chunk to the service as a MedicalScribeAudioEvent.
   *
   * @param chunk - PCM 16-bit audio data buffer
   * @throws Error if the streamer is not connected
   * @see Requirements 5.1, 5.2
   */
  sendAudioChunk(chunk: Buffer): void {
    if (this._isClosed) {
      throw new Error('AudioStreamer has been closed.');
    }

    if (!this._isConnected || !this.stream) {
      throw new Error('AudioStreamer is not connected. Call connect() first.');
    }

    const event: MedicalScribeAudioEvent = {
      audioChunk: chunk,
    };

    // Encode the audio event as a JSON message with the binary payload
    const message = JSON.stringify({
      audioEvent: {
        audioChunk: event.audioChunk.toString('base64'),
      },
    });

    this.stream.write(message + '\n');

    // Reset silence timer on each audio chunk sent
    this.resetSilenceTimer();
  }

  /**
   * Sends an END_OF_SESSION control event and closes the stream.
   *
   * @see Requirements 5.1
   */
  async endStream(): Promise<void> {
    if (!this._isConnected || !this.stream) {
      return;
    }

    const message = JSON.stringify({
      sessionControlEvent: {
        type: 'END_OF_SESSION',
      } satisfies SessionControlEvent,
    });

    return new Promise<void>((resolve) => {
      if (this.stream) {
        this.stream.write(message + '\n', () => {
          this.stream?.end();
          this.cleanup();
          resolve();
        });
      } else {
        this.cleanup();
        resolve();
      }
    });
  }

  /**
   * Forcefully closes the connection without sending END_OF_SESSION.
   * Use this for error recovery or cleanup.
   */
  destroy(): void {
    this.cleanup();
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  /**
   * Opens the HTTP/2 stream to the service endpoint.
   */
  private openStream(url: URL): void {
    if (!this.session) {
      throw new Error('HTTP/2 session not established.');
    }

    const path = url.pathname + url.search;

    this.stream = this.session.request({
      ':method': 'POST',
      ':path': path,
      'content-type': 'application/vnd.amazon.eventstream',
    });

    this.stream.on('data', (data: Buffer) => {
      this.handleResponseData(data);
    });

    this.stream.on('end', () => {
      if (!this._isClosed) {
        this.cleanup();
      }
    });

    this.stream.on('error', (err: Error) => {
      this.handleStreamError(err);
    });

    this.stream.on('close', () => {
      if (this._isConnected && !this._isClosed) {
        this.handleStreamDrop();
      }
    });
  }

  /**
   * Handles incoming response data from the service.
   * Parses transcript events and emits them.
   */
  private handleResponseData(data: Buffer): void {
    // Reset silence timer when we receive data from the service
    this.resetSilenceTimer();

    this.responseBuffer += data.toString('utf-8');

    // Process complete JSON messages (newline-delimited)
    const lines = this.responseBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.responseBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        this.processServiceEvent(event);
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  /**
   * Processes a parsed service event and emits the appropriate event.
   */
  private processServiceEvent(event: Record<string, unknown>): void {
    // Handle transcript events
    if (event['transcriptEvent'] && typeof event['transcriptEvent'] === 'object') {
      const transcriptEvent = event['transcriptEvent'] as Record<string, unknown>;
      const segment = this.parseTranscriptEvent(transcriptEvent);
      if (segment) {
        this.emit('transcript', segment);
      }
    }
  }

  /**
   * Parses a transcript event from the service into a TranscriptSegment.
   */
  private parseTranscriptEvent(event: Record<string, unknown>): TranscriptSegment | null {
    try {
      const id = (event['segmentId'] as string) || `seg-${Date.now()}`;
      const content = (event['content'] as string) || '';
      const speaker = this.parseSpeakerRole(event['participantRole'] as string | undefined);
      const channelId = (event['channelId'] as number) ?? 0;
      const startTime = (event['startTime'] as number) ?? 0;
      const endTime = (event['endTime'] as number) ?? 0;
      const isPartial = (event['isPartial'] as boolean) ?? false;

      return {
        id,
        content,
        speaker,
        channelId,
        startTime,
        endTime,
        isPartial,
      };
    } catch {
      return null;
    }
  }

  /**
   * Maps a participant role string to the TranscriptSegment speaker type.
   */
  private parseSpeakerRole(role: string | undefined): 'CLINICIAN' | 'PATIENT' | 'UNKNOWN' {
    if (role === 'CLINICIAN') return 'CLINICIAN';
    if (role === 'PATIENT') return 'PATIENT';
    return 'UNKNOWN';
  }

  /**
   * Handles a connection-level error.
   */
  private handleConnectionError(err: Error): void {
    const streamerError: AudioStreamerError = {
      code: 'CONNECTION_ERROR',
      message: `HTTP/2 connection error: ${err.message}`,
      retryable: true,
    };
    this.emit('error', streamerError);
    this.cleanup();
  }

  /**
   * Handles a stream-level error.
   */
  private handleStreamError(err: Error): void {
    const streamerError: AudioStreamerError = {
      code: 'STREAM_ERROR',
      message: `HTTP/2 stream error: ${err.message}`,
      retryable: true,
    };
    this.emit('error', streamerError);
    this.cleanup();
  }

  /**
   * Handles an unexpected stream drop (connection lost without explicit close).
   *
   * @see Requirements 5.6
   */
  private handleStreamDrop(): void {
    const streamerError: AudioStreamerError = {
      code: 'STREAM_DROP',
      message: 'HTTP/2 stream connection dropped unexpectedly.',
      retryable: true,
    };
    this.emit('error', streamerError);
    this.cleanup();
  }

  /**
   * Starts the silence detection timer.
   * Emits 'silence' event if no data is received for 30 seconds.
   *
   * @see Requirements 5.6
   */
  private startSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.emit('silence');
    }, SILENCE_TIMEOUT_MS);
  }

  /**
   * Resets the silence detection timer.
   * Called whenever audio is sent or data is received.
   */
  private resetSilenceTimer(): void {
    this.startSilenceTimer();
  }

  /**
   * Clears the silence detection timer.
   */
  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Cleans up all resources: timers, streams, and session.
   */
  private cleanup(): void {
    if (this._isClosed) {
      return;
    }

    this._isClosed = true;
    this._isConnected = false;
    this.clearSilenceTimer();

    if (this.stream) {
      try {
        this.stream.close();
      } catch {
        // Ignore errors during cleanup
      }
      this.stream = null;
    }

    if (this.session) {
      try {
        this.session.close();
      } catch {
        // Ignore errors during cleanup
      }
      this.session = null;
    }

    this.emit('closed');
  }
}

// ─── Typed EventEmitter Helpers ──────────────────────────────────────────────

// Re-export for convenience
export { SILENCE_TIMEOUT_MS, MIN_TLS_VERSION };
