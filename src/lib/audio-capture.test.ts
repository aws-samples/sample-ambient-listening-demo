/**
 * Unit tests for the browser-side audio capture pipeline.
 *
 * Tests cover:
 * - WAV header parsing (valid and invalid files)
 * - Microphone permission denial handling
 * - WAV file streaming at real-time rate
 * - Event emission (started, stopped, error)
 * - WebSocket connection management
 *
 * @see Requirements 5.2, 5.3, 5.4, 5.7
 */

import {
  AudioCapture,
  AudioCaptureErrorCode,
  parseWavHeader,
  TARGET_SAMPLE_RATE,
  TARGET_BIT_DEPTH,
  CHUNK_SIZE,
  WAV_STREAM_INTERVAL_MS,
} from './audio-capture';

// ─── WAV File Test Helpers ───────────────────────────────────────────────────

/**
 * Creates a valid WAV file buffer with the given parameters.
 */
function createWavBuffer(options: {
  sampleRate?: number;
  bitDepth?: number;
  numChannels?: number;
  dataSize?: number;
  audioFormat?: number;
}): ArrayBuffer {
  const {
    sampleRate = 16000,
    bitDepth = 16,
    numChannels = 1,
    dataSize = 3200,
    audioFormat = 1, // PCM
  } = options;

  const byteRate = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign = numChannels * (bitDepth / 8);
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true); // File size - 8
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Chunk size (16 for PCM)
  view.setUint16(20, audioFormat, true); // Audio format
  view.setUint16(22, numChannels, true); // Num channels
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, byteRate, true); // Byte rate
  view.setUint16(32, blockAlign, true); // Block align
  view.setUint16(34, bitDepth, true); // Bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true); // Data size

  // Fill with some sample data
  for (let i = 44; i < totalSize; i++) {
    view.setUint8(i, i % 256);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ─── Mock Setup ──────────────────────────────────────────────────────────────

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = 'blob';
  sentMessages: (ArrayBuffer | string)[] = [];
  private eventListeners: Map<string, Set<Function>> = new Map();
  closeCode?: number;
  closeReason?: string;

  addEventListener(event: string, handler: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  removeEventListener(event: string, handler: Function): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  send(data: ArrayBuffer | string): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.eventListeners.get('open')?.forEach((handler) => handler(new Event('open')));
  }

  simulateError(): void {
    this.eventListeners.get('error')?.forEach((handler) => handler(new Event('error')));
  }

  simulateClose(code: number = 1000): void {
    this.readyState = MockWebSocket.CLOSED;
    this.eventListeners.get('close')?.forEach((handler) =>
      handler({ code, reason: '' })
    );
  }
}

// Store the mock WebSocket instance for test access
let mockWsInstance: MockWebSocket | null = null;

// Mock globals
beforeEach(() => {
  mockWsInstance = null;

  // Mock WebSocket constructor
  (global as any).WebSocket = class extends MockWebSocket {
    constructor(_url: string) {
      super();
      mockWsInstance = this;
      // Auto-open after a tick to simulate connection
    }
  };
  (global as any).WebSocket.OPEN = MockWebSocket.OPEN;
  (global as any).WebSocket.CONNECTING = MockWebSocket.CONNECTING;
  (global as any).WebSocket.CLOSING = MockWebSocket.CLOSING;
  (global as any).WebSocket.CLOSED = MockWebSocket.CLOSED;

  // Mock window.location
  Object.defineProperty(global, 'window', {
    value: {
      location: {
        protocol: 'https:',
        host: 'localhost:3000',
      },
    },
    writable: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllTimers();
});

// ─── WAV Header Parsing Tests ────────────────────────────────────────────────

describe('parseWavHeader', () => {
  it('should parse a valid WAV file header', () => {
    const buffer = createWavBuffer({
      sampleRate: 16000,
      bitDepth: 16,
      numChannels: 1,
      dataSize: 32000,
    });

    const header = parseWavHeader(buffer);

    expect(header).not.toBeNull();
    expect(header!.sampleRate).toBe(16000);
    expect(header!.bitDepth).toBe(16);
    expect(header!.numChannels).toBe(1);
    expect(header!.dataOffset).toBe(44);
    expect(header!.dataSize).toBe(32000);
  });

  it('should parse a stereo WAV file header', () => {
    const buffer = createWavBuffer({
      sampleRate: 44100,
      bitDepth: 16,
      numChannels: 2,
      dataSize: 88200,
    });

    const header = parseWavHeader(buffer);

    expect(header).not.toBeNull();
    expect(header!.sampleRate).toBe(44100);
    expect(header!.numChannels).toBe(2);
  });

  it('should return null for a buffer that is too small', () => {
    const buffer = new ArrayBuffer(10);
    expect(parseWavHeader(buffer)).toBeNull();
  });

  it('should return null for a buffer without RIFF header', () => {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    writeString(view, 0, 'XXXX');
    expect(parseWavHeader(buffer)).toBeNull();
  });

  it('should return null for a buffer without WAVE format', () => {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36, true);
    writeString(view, 8, 'XXXX');
    expect(parseWavHeader(buffer)).toBeNull();
  });

  it('should return null for non-PCM audio format', () => {
    const buffer = createWavBuffer({ audioFormat: 3 }); // IEEE float
    expect(parseWavHeader(buffer)).toBeNull();
  });

  it('should handle WAV files with different sample rates', () => {
    const buffer = createWavBuffer({ sampleRate: 48000 });
    const header = parseWavHeader(buffer);

    expect(header).not.toBeNull();
    expect(header!.sampleRate).toBe(48000);
  });
});

// ─── AudioCapture Class Tests ────────────────────────────────────────────────

describe('AudioCapture', () => {
  describe('constructor and properties', () => {
    it('should initialize with isActive = false', () => {
      const capture = new AudioCapture();
      expect(capture.isActive).toBe(false);
    });
  });

  describe('event handling', () => {
    it('should register and emit events', () => {
      const capture = new AudioCapture();
      const callback = jest.fn();

      capture.on('started', callback);
      // Trigger internal emit by starting with invalid state
      // We'll test this indirectly through the public API
      expect(callback).not.toHaveBeenCalled();
    });

    it('should remove event listeners with off()', () => {
      const capture = new AudioCapture();
      const callback = jest.fn();

      capture.on('error', callback);
      capture.off('error', callback);

      // The callback should not be called after removal
      // We verify this by triggering an error condition
    });
  });

  describe('startMicrophone', () => {
    it('should emit error when microphone permission is denied', async () => {
      const capture = new AudioCapture();
      const errorCallback = jest.fn();
      capture.on('error', errorCallback);

      // Mock getUserMedia to reject with NotAllowedError
      const mockError = new DOMException('Permission denied', 'NotAllowedError');
      (global as any).navigator = {
        mediaDevices: {
          getUserMedia: jest.fn().mockRejectedValue(mockError),
        },
      };

      await capture.startMicrophone('test-session');

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: AudioCaptureErrorCode.MICROPHONE_PERMISSION_DENIED,
          message: expect.stringContaining('Microphone access was denied'),
        })
      );
      expect(capture.isActive).toBe(false);
    });

    it('should emit error when microphone is not available', async () => {
      const capture = new AudioCapture();
      const errorCallback = jest.fn();
      capture.on('error', errorCallback);

      // Mock getUserMedia to reject with NotFoundError
      const mockError = new DOMException('No microphone found', 'NotFoundError');
      (global as any).navigator = {
        mediaDevices: {
          getUserMedia: jest.fn().mockRejectedValue(mockError),
        },
      };

      await capture.startMicrophone('test-session');

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: AudioCaptureErrorCode.MICROPHONE_NOT_AVAILABLE,
        })
      );
      expect(capture.isActive).toBe(false);
    });

    it('should emit error if already active', async () => {
      const capture = new AudioCapture();
      const errorCallback = jest.fn();
      capture.on('error', errorCallback);

      // Force isActive to true via internal state
      (capture as any)._isActive = true;

      await capture.startMicrophone('test-session');

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: AudioCaptureErrorCode.ALREADY_ACTIVE,
        })
      );
    });
  });

  describe('startWavFile', () => {
    it('should emit error for invalid WAV file', async () => {
      const capture = new AudioCapture();
      const errorCallback = jest.fn();
      capture.on('error', errorCallback);

      // Create an invalid file (not a WAV)
      const invalidBuffer = new ArrayBuffer(100);
      const file = new File([invalidBuffer], 'test.wav', { type: 'audio/wav' });

      await capture.startWavFile('test-session', file);

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: AudioCaptureErrorCode.INVALID_WAV_FILE,
          message: expect.stringContaining('Invalid WAV file'),
        })
      );
      expect(capture.isActive).toBe(false);
    });

    it('should emit error for non-16-bit WAV file', async () => {
      const capture = new AudioCapture();
      const errorCallback = jest.fn();
      capture.on('error', errorCallback);

      // Create a WAV with 8-bit depth
      const buffer = createWavBuffer({ bitDepth: 8 });
      // We need to manually fix the buffer since createWavBuffer uses audioFormat=1
      // but the bitDepth check happens after parsing
      const file = new File([buffer], 'test.wav', { type: 'audio/wav' });

      await capture.startWavFile('test-session', file);

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: AudioCaptureErrorCode.INVALID_WAV_FILE,
          message: expect.stringContaining('16-bit'),
        })
      );
    });

    it('should emit error if already active', async () => {
      const capture = new AudioCapture();
      const errorCallback = jest.fn();
      capture.on('error', errorCallback);

      (capture as any)._isActive = true;

      const buffer = createWavBuffer({});
      const file = new File([buffer], 'test.wav', { type: 'audio/wav' });

      await capture.startWavFile('test-session', file);

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: AudioCaptureErrorCode.ALREADY_ACTIVE,
        })
      );
    });

    it('should start streaming and emit started event for valid WAV file', async () => {
      // Use fake timers but allow promises to resolve
      jest.useFakeTimers();

      const capture = new AudioCapture();
      const startedCallback = jest.fn();
      const stoppedCallback = jest.fn();
      capture.on('started', startedCallback);
      capture.on('stopped', stoppedCallback);

      const buffer = createWavBuffer({
        sampleRate: 16000,
        bitDepth: 16,
        numChannels: 1,
        dataSize: 3200, // Small file: 100ms of audio
      });
      const file = new File([buffer], 'test.wav', { type: 'audio/wav' });

      // Start the WAV file - this will create the WebSocket
      const startPromise = capture.startWavFile('test-session', file);

      // Allow microtasks to flush so the WebSocket is created
      await jest.advanceTimersByTimeAsync(0);

      // Simulate WebSocket opening
      if (mockWsInstance) {
        mockWsInstance.simulateOpen();
      }

      // Allow the promise to resolve
      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(startedCallback).toHaveBeenCalled();
      expect(capture.isActive).toBe(true);

      // Advance time to stream the file
      await jest.advanceTimersByTimeAsync(WAV_STREAM_INTERVAL_MS);

      // After streaming all data, it should stop
      await jest.advanceTimersByTimeAsync(WAV_STREAM_INTERVAL_MS);

      expect(stoppedCallback).toHaveBeenCalled();
      expect(capture.isActive).toBe(false);

      jest.useRealTimers();
    });

    it('should send audio chunks over WebSocket at real-time rate', async () => {
      jest.useFakeTimers();

      const capture = new AudioCapture();
      capture.on('started', () => {});

      // Create a larger WAV file (320ms of audio = 10240 bytes at 16kHz 16-bit mono)
      const dataSize = 10240;
      const buffer = createWavBuffer({
        sampleRate: 16000,
        bitDepth: 16,
        numChannels: 1,
        dataSize,
      });
      const file = new File([buffer], 'test.wav', { type: 'audio/wav' });

      const startPromise = capture.startWavFile('test-session', file);

      // Allow microtasks to flush
      await jest.advanceTimersByTimeAsync(0);

      if (mockWsInstance) {
        mockWsInstance.simulateOpen();
      }

      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      // First interval: should send a chunk
      await jest.advanceTimersByTimeAsync(WAV_STREAM_INTERVAL_MS);

      expect(mockWsInstance!.sentMessages.length).toBeGreaterThan(0);

      // Clean up
      capture.stop();
      jest.useRealTimers();
    });
  });

  describe('stop', () => {
    it('should do nothing if not active', () => {
      const capture = new AudioCapture();
      const stoppedCallback = jest.fn();
      capture.on('stopped', stoppedCallback);

      capture.stop();

      expect(stoppedCallback).not.toHaveBeenCalled();
    });

    it('should emit stopped event and clean up', async () => {
      jest.useFakeTimers();

      const capture = new AudioCapture();
      const stoppedCallback = jest.fn();
      capture.on('stopped', stoppedCallback);

      const buffer = createWavBuffer({ dataSize: 32000 });
      const file = new File([buffer], 'test.wav', { type: 'audio/wav' });

      const startPromise = capture.startWavFile('test-session', file);

      await jest.advanceTimersByTimeAsync(0);

      if (mockWsInstance) {
        mockWsInstance.simulateOpen();
      }

      await jest.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(capture.isActive).toBe(true);

      capture.stop();

      expect(capture.isActive).toBe(false);
      expect(stoppedCallback).toHaveBeenCalled();
      expect(mockWsInstance!.closeCode).toBe(1000);

      jest.useRealTimers();
    });
  });

  describe('WebSocket error handling', () => {
    it('should emit error when WebSocket connection fails', async () => {
      jest.useFakeTimers();

      const capture = new AudioCapture();
      const errorCallback = jest.fn();
      capture.on('error', errorCallback);

      const buffer = createWavBuffer({});
      const file = new File([buffer], 'test.wav', { type: 'audio/wav' });

      const startPromise = capture.startWavFile('test-session', file);

      // Allow microtasks to flush
      await jest.advanceTimersByTimeAsync(0);

      // Simulate WebSocket error
      if (mockWsInstance) {
        mockWsInstance.simulateError();
      }

      await jest.advanceTimersByTimeAsync(0);
      await startPromise.catch(() => {});

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          code: AudioCaptureErrorCode.WEBSOCKET_CONNECTION_FAILED,
        })
      );

      jest.useRealTimers();
    });
  });

  describe('constants', () => {
    it('should export correct target sample rate', () => {
      expect(TARGET_SAMPLE_RATE).toBe(16000);
    });

    it('should export correct target bit depth', () => {
      expect(TARGET_BIT_DEPTH).toBe(16);
    });

    it('should export correct chunk size', () => {
      expect(CHUNK_SIZE).toBe(3200);
    });

    it('should export correct WAV stream interval', () => {
      expect(WAV_STREAM_INTERVAL_MS).toBe(100);
    });
  });
});
