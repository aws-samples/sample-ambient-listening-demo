/**
 * Browser-side audio capture pipeline for the Ambient Clinical Documentation Demo.
 *
 * Provides two modes of audio capture:
 * 1. Microphone mode: getUserMedia() → AudioWorklet (PCM 16-bit, 16kHz) → WebSocket
 * 2. WAV file mode: FileReader → parse WAV header → stream PCM at real-time rate → WebSocket
 *
 * Handles microphone permission denial with a user-facing error.
 * Emits events: 'error', 'started', 'stopped'.
 *
 * @see Requirements 5.2, 5.3, 5.4, 5.7
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Target sample rate for audio capture (16 kHz). */
export const TARGET_SAMPLE_RATE = 16000;

/** Target bit depth for audio capture (16-bit). */
export const TARGET_BIT_DEPTH = 16;

/** Size of audio chunks sent over WebSocket (in bytes). ~100ms of audio at 16kHz 16-bit mono. */
export const CHUNK_SIZE = 3200;

/** Interval for streaming WAV file chunks at real-time rate (ms). */
export const WAV_STREAM_INTERVAL_MS = 100;

// ─── Error Types ─────────────────────────────────────────────────────────────

/**
 * Error codes for audio capture failures.
 */
export enum AudioCaptureErrorCode {
  MICROPHONE_PERMISSION_DENIED = 'MICROPHONE_PERMISSION_DENIED',
  MICROPHONE_NOT_AVAILABLE = 'MICROPHONE_NOT_AVAILABLE',
  WEBSOCKET_CONNECTION_FAILED = 'WEBSOCKET_CONNECTION_FAILED',
  WEBSOCKET_CLOSED = 'WEBSOCKET_CLOSED',
  INVALID_WAV_FILE = 'INVALID_WAV_FILE',
  AUDIO_CONTEXT_FAILED = 'AUDIO_CONTEXT_FAILED',
  ALREADY_ACTIVE = 'ALREADY_ACTIVE',
}

/**
 * Error details for audio capture failures.
 */
export interface AudioCaptureError {
  code: AudioCaptureErrorCode;
  message: string;
}

// ─── Event Types ─────────────────────────────────────────────────────────────

/**
 * Events emitted by the AudioCapture class.
 */
export type AudioCaptureEventType = 'error' | 'started' | 'stopped';

/**
 * Callback type for audio capture events.
 */
export type AudioCaptureEventCallback = (data?: AudioCaptureError) => void;

// ─── WAV Header Parsing ──────────────────────────────────────────────────────

/**
 * Parsed WAV file header information.
 */
export interface WavHeader {
  sampleRate: number;
  bitDepth: number;
  numChannels: number;
  dataOffset: number;
  dataSize: number;
}

/**
 * Parses a WAV file header to extract audio format information.
 *
 * WAV file format:
 * - Bytes 0-3: "RIFF"
 * - Bytes 8-11: "WAVE"
 * - fmt chunk: contains audio format details
 * - data chunk: contains the PCM audio data
 *
 * @param buffer - The ArrayBuffer containing the WAV file data
 * @returns Parsed WAV header or null if the file is invalid
 */
export function parseWavHeader(buffer: ArrayBuffer): WavHeader | null {
  if (buffer.byteLength < 44) {
    return null;
  }

  const view = new DataView(buffer);

  // Verify RIFF header
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (riff !== 'RIFF') {
    return null;
  }

  // Verify WAVE format
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11)
  );
  if (wave !== 'WAVE') {
    return null;
  }

  // Parse chunks to find fmt and data
  let offset = 12;
  let sampleRate = 0;
  let bitDepth = 0;
  let numChannels = 0;
  let dataOffset = 0;
  let dataSize = 0;
  let foundFmt = false;
  let foundData = false;

  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      // Audio format = 1 means PCM
      const audioFormat = view.getUint16(offset + 8, true);
      if (audioFormat !== 1) {
        return null; // Not PCM
      }
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      // Skip byteRate (offset + 16) and blockAlign (offset + 20)
      bitDepth = view.getUint16(offset + 22, true);
      foundFmt = true;
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      foundData = true;
    }

    // Move to next chunk (chunk header is 8 bytes + chunk size)
    offset += 8 + chunkSize;

    if (foundFmt && foundData) {
      break;
    }
  }

  if (!foundFmt || !foundData) {
    return null;
  }

  return {
    sampleRate,
    bitDepth,
    numChannels,
    dataOffset,
    dataSize,
  };
}

// ─── AudioWorklet Processor Code ─────────────────────────────────────────────

/**
 * AudioWorklet processor code as a string.
 * This runs in the AudioWorklet thread and converts Float32 samples to PCM 16-bit.
 * It accumulates samples and posts them to the main thread in chunks.
 */
export const AUDIO_WORKLET_PROCESSOR_CODE = `
class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._chunkSize = ${CHUNK_SIZE / 2}; // 16-bit = 2 bytes per sample
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    for (let i = 0; i < samples.length; i++) {
      this._buffer.push(samples[i]);
    }

    while (this._buffer.length >= this._chunkSize) {
      const chunk = this._buffer.splice(0, this._chunkSize);
      const pcm16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm16-processor', PCM16Processor);
`;

// ─── AudioCapture Class ──────────────────────────────────────────────────────

/**
 * Browser-side audio capture pipeline.
 *
 * Supports two modes:
 * - Microphone: captures live audio via getUserMedia, processes through AudioWorklet
 *   to produce PCM 16-bit 16kHz, and streams to WebSocket.
 * - WAV file: reads a WAV file, parses the header, and streams PCM data at real-time
 *   rate to WebSocket.
 *
 * Usage:
 * ```typescript
 * const capture = new AudioCapture();
 * capture.on('started', () => console.log('Capture started'));
 * capture.on('stopped', () => console.log('Capture stopped'));
 * capture.on('error', (err) => console.error(err));
 *
 * // Microphone mode
 * await capture.startMicrophone('session-123');
 *
 * // Or WAV file mode
 * await capture.startWavFile('session-123', wavFile);
 *
 * // Stop capture
 * capture.stop();
 * ```
 *
 * @see Requirements 5.2, 5.3, 5.4, 5.7
 */
export class AudioCapture {
  private _isActive = false;
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private wavStreamTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Map<AudioCaptureEventType, Set<AudioCaptureEventCallback>> = new Map();

  /**
   * Whether audio capture is currently active.
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Registers an event listener.
   *
   * @param event - The event type to listen for
   * @param callback - The callback to invoke when the event fires
   */
  on(event: AudioCaptureEventType, callback: AudioCaptureEventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * Removes an event listener.
   *
   * @param event - The event type
   * @param callback - The callback to remove
   */
  off(event: AudioCaptureEventType, callback: AudioCaptureEventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  /**
   * Starts microphone capture and streams PCM 16-bit 16kHz audio to WebSocket.
   *
   * Pipeline: getUserMedia() → AudioWorklet (PCM 16-bit, 16kHz) → WebSocket
   *
   * @param sessionId - The session ID to connect the WebSocket to
   * @throws AudioCaptureError if microphone permission is denied or capture fails
   * @see Requirements 5.2, 5.3, 5.7
   */
  async startMicrophone(sessionId: string): Promise<void> {
    if (this._isActive) {
      this.emitError({
        code: AudioCaptureErrorCode.ALREADY_ACTIVE,
        message: 'Audio capture is already active. Call stop() first.',
      });
      return;
    }

    // Step 1: Request microphone access
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: TARGET_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      const error = err as DOMException;
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        this.emitError({
          code: AudioCaptureErrorCode.MICROPHONE_PERMISSION_DENIED,
          message:
            'Microphone access was denied. Please grant microphone permission in your browser settings and try again.',
        });
      } else {
        this.emitError({
          code: AudioCaptureErrorCode.MICROPHONE_NOT_AVAILABLE,
          message: `Microphone is not available: ${error.message}`,
        });
      }
      return;
    }

    this.mediaStream = stream;

    // Step 2: Set up AudioContext and AudioWorklet
    try {
      this.audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });

      // Create a Blob URL for the AudioWorklet processor
      const blob = new Blob([AUDIO_WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);

      await this.audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = this.audioContext.createMediaStreamSource(stream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm16-processor');

      // Step 3: Connect WebSocket
      this.ws = this.createWebSocket(sessionId);

      await this.waitForWebSocketOpen(this.ws);

      // Step 4: Wire up the pipeline
      this.workletNode.port.onmessage = (event: MessageEvent) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(event.data as ArrayBuffer);
        }
      };

      source.connect(this.workletNode);
      // Connect to destination to keep the audio graph alive (output is silent)
      this.workletNode.connect(this.audioContext.destination);

      this._isActive = true;
      this.emit('started');
    } catch (err) {
      this.cleanupMicrophone();
      const message = err instanceof Error ? err.message : String(err);
      this.emitError({
        code: AudioCaptureErrorCode.AUDIO_CONTEXT_FAILED,
        message: `Failed to set up audio capture: ${message}`,
      });
    }
  }

  /**
   * Starts streaming a WAV file at real-time rate to WebSocket.
   *
   * Pipeline: FileReader → parse WAV header → stream PCM at real-time rate → WebSocket
   *
   * @param sessionId - The session ID to connect the WebSocket to
   * @param file - The WAV file to stream
   * @see Requirements 5.4
   */
  async startWavFile(sessionId: string, file: File): Promise<void> {
    if (this._isActive) {
      this.emitError({
        code: AudioCaptureErrorCode.ALREADY_ACTIVE,
        message: 'Audio capture is already active. Call stop() first.',
      });
      return;
    }

    // Step 1: Read the file
    const arrayBuffer = await file.arrayBuffer();

    // Step 2: Parse WAV header
    const header = parseWavHeader(arrayBuffer);
    if (!header) {
      this.emitError({
        code: AudioCaptureErrorCode.INVALID_WAV_FILE,
        message:
          'Invalid WAV file. The file must be a valid WAV file with PCM encoding.',
      });
      return;
    }

    // Validate format: must be PCM 16-bit
    if (header.bitDepth !== TARGET_BIT_DEPTH) {
      this.emitError({
        code: AudioCaptureErrorCode.INVALID_WAV_FILE,
        message: `Invalid WAV file: expected ${TARGET_BIT_DEPTH}-bit depth, got ${header.bitDepth}-bit.`,
      });
      return;
    }

    // Step 3: Connect WebSocket
    this.ws = this.createWebSocket(sessionId);

    try {
      await this.waitForWebSocketOpen(this.ws);
    } catch {
      this.ws = null;
      return;
    }

    // Step 4: Stream PCM data at real-time rate
    this._isActive = true;
    this.emit('started');

    const pcmData = new Uint8Array(arrayBuffer, header.dataOffset, header.dataSize);
    const bytesPerSecond = header.sampleRate * (header.bitDepth / 8) * header.numChannels;
    const bytesPerInterval = Math.floor(
      (bytesPerSecond * WAV_STREAM_INTERVAL_MS) / 1000
    );

    let offset = 0;

    this.wavStreamTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stop();
        return;
      }

      if (offset >= pcmData.length) {
        // Finished streaming the file
        this.stop();
        return;
      }

      const end = Math.min(offset + bytesPerInterval, pcmData.length);
      const chunk = pcmData.slice(offset, end);
      this.ws.send(chunk.buffer);
      offset = end;
    }, WAV_STREAM_INTERVAL_MS);
  }

  /**
   * Stops audio capture and closes the WebSocket connection.
   */
  stop(): void {
    if (!this._isActive) {
      return;
    }

    this._isActive = false;

    // Stop WAV streaming timer
    if (this.wavStreamTimer) {
      clearInterval(this.wavStreamTimer);
      this.wavStreamTimer = null;
    }

    // Clean up microphone resources
    this.cleanupMicrophone();

    // Close WebSocket
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Audio capture stopped');
      }
      this.ws = null;
    }

    this.emit('stopped');
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  /**
   * Creates a WebSocket connection to the audio endpoint.
   */
  private createWebSocket(sessionId: string): WebSocket {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/audio/${sessionId}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('error', () => {
      this.emitError({
        code: AudioCaptureErrorCode.WEBSOCKET_CONNECTION_FAILED,
        message: 'WebSocket connection failed. Please check your network connection.',
      });
    });

    ws.addEventListener('close', (event) => {
      if (this._isActive && event.code !== 1000) {
        this.emitError({
          code: AudioCaptureErrorCode.WEBSOCKET_CLOSED,
          message: `WebSocket connection closed unexpectedly (code: ${event.code}).`,
        });
        this.stop();
      }
    });

    return ws;
  }

  /**
   * Waits for a WebSocket to reach the OPEN state.
   */
  private waitForWebSocketOpen(ws: WebSocket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const onOpen = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        resolve();
      };

      const onError = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        this.emitError({
          code: AudioCaptureErrorCode.WEBSOCKET_CONNECTION_FAILED,
          message: 'Failed to establish WebSocket connection.',
        });
        reject(new Error('WebSocket connection failed'));
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
    });
  }

  /**
   * Cleans up microphone-specific resources (AudioContext, MediaStream, WorkletNode).
   */
  private cleanupMicrophone(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.onmessage = null;
      this.workletNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {
        // Ignore errors during cleanup
      });
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  /**
   * Emits an event to all registered listeners.
   */
  private emit(event: AudioCaptureEventType, data?: AudioCaptureError): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }

  /**
   * Emits an error event.
   */
  private emitError(error: AudioCaptureError): void {
    this.emit('error', error);
  }
}
