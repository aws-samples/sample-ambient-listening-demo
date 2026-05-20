/**
 * Unit tests for the AudioStreamer module.
 *
 * Tests cover:
 * - Construction and initial state
 * - Connection lifecycle (connect, send, end)
 * - Silence detection (30-second timeout)
 * - Stream drop handling
 * - Error emission
 * - MedicalScribeAudioEvent publishing
 * - SessionControlEvent (END_OF_SESSION) sending
 * - TLS 1.2+ enforcement
 *
 * @see Requirements 5.1, 5.2, 5.6, 13.4
 */

import { EventEmitter } from 'events';
import {
  AudioStreamer,
  AudioStreamerConfig,
  AudioStreamerError,
  SILENCE_TIMEOUT_MS,
  MIN_TLS_VERSION,
} from './audio-streamer';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the http2 module
let mockStream: EventEmitter & {
  write: jest.Mock;
  end: jest.Mock;
  close: jest.Mock;
};

let mockSession: EventEmitter & {
  request: jest.Mock;
  close: jest.Mock;
};

function createMockStream() {
  const stream = new EventEmitter() as EventEmitter & {
    write: jest.Mock;
    end: jest.Mock;
    close: jest.Mock;
  };
  stream.write = jest.fn((_data: string, cb?: () => void) => {
    if (cb) cb();
    return true;
  });
  stream.end = jest.fn();
  stream.close = jest.fn();
  return stream;
}

function createMockSession() {
  const session = new EventEmitter() as EventEmitter & {
    request: jest.Mock;
    close: jest.Mock;
  };
  session.request = jest.fn(() => mockStream);
  session.close = jest.fn();
  return session;
}

jest.mock('http2', () => ({
  connect: jest.fn((_url: string, _options: unknown) => {
    // Emit 'connect' synchronously via setImmediate (not intercepted by legacy fake timers)
    setImmediate(() => {
      mockSession.emit('connect');
    });
    return mockSession;
  }),
}));

jest.mock('tls', () => ({
  // Just export the type reference
}));

// ─── Test Setup ──────────────────────────────────────────────────────────────

const defaultConfig: AudioStreamerConfig = {
  streamUrl: 'https://connect-health.us-east-1.amazonaws.com/stream/session-123?token=abc',
  sessionId: 'session-123',
};

describe('AudioStreamer', () => {
  let streamer: AudioStreamer;

  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: false, doNotFake: ['setImmediate', 'clearImmediate', 'nextTick'] });
    jest.clearAllMocks();
    // Create fresh mocks for each test
    mockStream = createMockStream();
    mockSession = createMockSession();

    streamer = new AudioStreamer(defaultConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
    streamer.destroy();
  });

  // ─── Construction ──────────────────────────────────────────────────────────

  describe('construction', () => {
    it('should initialize with isConnected = false', () => {
      expect(streamer.isConnected).toBe(false);
    });

    it('should initialize with isClosed = false', () => {
      expect(streamer.isClosed).toBe(false);
    });
  });

  // ─── Connection ────────────────────────────────────────────────────────────

  describe('connect()', () => {
    it('should establish HTTP/2 connection and emit connected event', async () => {
      const connectedHandler = jest.fn();
      streamer.on('connected', connectedHandler);

      await streamer.connect();

      expect(streamer.isConnected).toBe(true);
      expect(connectedHandler).toHaveBeenCalledTimes(1);
    });

    it('should enforce TLS 1.2+ via minVersion option', async () => {
      const http2 = require('http2');
      await streamer.connect();

      expect(http2.connect).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          minVersion: MIN_TLS_VERSION,
          rejectUnauthorized: true,
        })
      );
    });

    it('should connect to the correct host from stream URL', async () => {
      const http2 = require('http2');
      await streamer.connect();

      expect(http2.connect).toHaveBeenCalledWith(
        'https://connect-health.us-east-1.amazonaws.com',
        expect.any(Object)
      );
    });

    it('should open a POST stream with correct path', async () => {
      await streamer.connect();

      expect(mockSession.request).toHaveBeenCalledWith({
        ':method': 'POST',
        ':path': '/stream/session-123?token=abc',
        'content-type': 'application/vnd.amazon.eventstream',
      });
    });

    it('should be idempotent when already connected', async () => {
      await streamer.connect();
      await streamer.connect(); // Should not throw

      expect(streamer.isConnected).toBe(true);
    });

    it('should throw if called after close', async () => {
      await streamer.connect();
      streamer.destroy();

      await expect(streamer.connect()).rejects.toThrow(
        'AudioStreamer has been closed and cannot be reconnected.'
      );
    });

    it('should reject if session emits error before connect', async () => {
      const http2 = require('http2');
      http2.connect.mockImplementationOnce((_url: string, _options: unknown) => {
        setImmediate(() => {
          mockSession.emit('error', new Error('Connection refused'));
        });
        return mockSession;
      });

      const newStreamer = new AudioStreamer(defaultConfig);
      // Add error listener to prevent unhandled error event
      newStreamer.on('error', () => {});
      await expect(newStreamer.connect()).rejects.toThrow('Connection refused');
    });
  });

  // ─── sendAudioChunk ────────────────────────────────────────────────────────

  describe('sendAudioChunk()', () => {
    it('should throw if not connected', () => {
      const chunk = Buffer.from([0x00, 0x01, 0x02]);
      expect(() => streamer.sendAudioChunk(chunk)).toThrow(
        'AudioStreamer is not connected. Call connect() first.'
      );
    });

    it('should throw if closed', async () => {
      await streamer.connect();
      streamer.destroy();

      const chunk = Buffer.from([0x00, 0x01, 0x02]);
      expect(() => streamer.sendAudioChunk(chunk)).toThrow(
        'AudioStreamer has been closed.'
      );
    });

    it('should write a MedicalScribeAudioEvent JSON message to the stream', async () => {
      await streamer.connect();
      const chunk = Buffer.from([0x00, 0x01, 0x02, 0x03]);

      streamer.sendAudioChunk(chunk);

      expect(mockStream.write).toHaveBeenCalledTimes(1);
      const writtenData = mockStream.write.mock.calls[0]![0] as string;
      const parsed = JSON.parse(writtenData.trim());
      expect(parsed).toEqual({
        audioEvent: {
          audioChunk: chunk.toString('base64'),
        },
      });
    });

    it('should encode audio chunk as base64 in the event', async () => {
      await streamer.connect();
      const pcmData = Buffer.alloc(320, 0xAB); // 320 bytes of PCM data

      streamer.sendAudioChunk(pcmData);

      const writtenData = mockStream.write.mock.calls[0]![0] as string;
      const parsed = JSON.parse(writtenData.trim());
      const decoded = Buffer.from(parsed.audioEvent.audioChunk, 'base64');
      expect(decoded).toEqual(pcmData);
    });

    it('should reset silence timer on each chunk sent', async () => {
      await streamer.connect();
      const silenceHandler = jest.fn();
      streamer.on('silence', silenceHandler);

      // Advance 25 seconds
      jest.advanceTimersByTime(25_000);
      expect(silenceHandler).not.toHaveBeenCalled();

      // Send a chunk (resets timer)
      streamer.sendAudioChunk(Buffer.from([0x00]));

      // Advance another 25 seconds (total 50s from start, but only 25s since last chunk)
      jest.advanceTimersByTime(25_000);
      expect(silenceHandler).not.toHaveBeenCalled();

      // Advance to 30s since last chunk
      jest.advanceTimersByTime(5_000);
      expect(silenceHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── endStream ─────────────────────────────────────────────────────────────

  describe('endStream()', () => {
    it('should send END_OF_SESSION control event', async () => {
      await streamer.connect();
      await streamer.endStream();

      // First write is the control event
      expect(mockStream.write).toHaveBeenCalledTimes(1);
      const writtenData = mockStream.write.mock.calls[0]![0] as string;
      const parsed = JSON.parse(writtenData.trim());
      expect(parsed).toEqual({
        sessionControlEvent: {
          type: 'END_OF_SESSION',
        },
      });
    });

    it('should call stream.end() after sending control event', async () => {
      await streamer.connect();
      await streamer.endStream();

      expect(mockStream.end).toHaveBeenCalledTimes(1);
    });

    it('should mark streamer as closed after ending', async () => {
      await streamer.connect();
      await streamer.endStream();

      expect(streamer.isClosed).toBe(true);
      expect(streamer.isConnected).toBe(false);
    });

    it('should emit closed event', async () => {
      await streamer.connect();
      const closedHandler = jest.fn();
      streamer.on('closed', closedHandler);

      await streamer.endStream();

      expect(closedHandler).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call when not connected', async () => {
      await expect(streamer.endStream()).resolves.toBeUndefined();
    });
  });

  // ─── Silence Detection ─────────────────────────────────────────────────────

  describe('silence detection', () => {
    it('should emit silence event after 30 seconds of no activity', async () => {
      await streamer.connect();
      const silenceHandler = jest.fn();
      streamer.on('silence', silenceHandler);

      jest.advanceTimersByTime(SILENCE_TIMEOUT_MS);

      expect(silenceHandler).toHaveBeenCalledTimes(1);
    });

    it('should not emit silence before 30 seconds', async () => {
      await streamer.connect();
      const silenceHandler = jest.fn();
      streamer.on('silence', silenceHandler);

      jest.advanceTimersByTime(SILENCE_TIMEOUT_MS - 1);

      expect(silenceHandler).not.toHaveBeenCalled();
    });

    it('should reset silence timer when receiving data from service', async () => {
      await streamer.connect();
      const silenceHandler = jest.fn();
      streamer.on('silence', silenceHandler);

      // Advance 20 seconds
      jest.advanceTimersByTime(20_000);

      // Simulate receiving data from service
      const transcriptData = JSON.stringify({
        transcriptEvent: {
          segmentId: 'seg-1',
          content: 'Hello',
          participantRole: 'CLINICIAN',
          channelId: 0,
          startTime: 0,
          endTime: 1,
          isPartial: false,
        },
      }) + '\n';
      mockStream.emit('data', Buffer.from(transcriptData));

      // Advance another 25 seconds (45s total, but only 25s since last data)
      jest.advanceTimersByTime(25_000);
      expect(silenceHandler).not.toHaveBeenCalled();

      // Advance to 30s since last data
      jest.advanceTimersByTime(5_000);
      expect(silenceHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Stream Drop Handling ──────────────────────────────────────────────────

  describe('stream drop handling', () => {
    it('should emit error with STREAM_DROP code on unexpected session close', async () => {
      await streamer.connect();
      const errorHandler = jest.fn();
      streamer.on('error', errorHandler);

      // Simulate unexpected session close
      mockSession.emit('close');

      expect(errorHandler).toHaveBeenCalledTimes(1);
      const error: AudioStreamerError = errorHandler.mock.calls[0]![0];
      expect(error.code).toBe('STREAM_DROP');
      expect(error.retryable).toBe(true);
    });

    it('should emit error with STREAM_DROP code on GOAWAY frame', async () => {
      await streamer.connect();
      const errorHandler = jest.fn();
      streamer.on('error', errorHandler);

      mockSession.emit('goaway');

      expect(errorHandler).toHaveBeenCalledTimes(1);
      const error: AudioStreamerError = errorHandler.mock.calls[0]![0];
      expect(error.code).toBe('STREAM_DROP');
      expect(error.retryable).toBe(true);
    });

    it('should emit error with STREAM_ERROR code on stream error', async () => {
      await streamer.connect();
      const errorHandler = jest.fn();
      streamer.on('error', errorHandler);

      mockStream.emit('error', new Error('Stream reset'));

      expect(errorHandler).toHaveBeenCalledTimes(1);
      const error: AudioStreamerError = errorHandler.mock.calls[0]![0];
      expect(error.code).toBe('STREAM_ERROR');
      expect(error.message).toContain('Stream reset');
      expect(error.retryable).toBe(true);
    });

    it('should clean up resources on stream drop', async () => {
      await streamer.connect();
      // Add error listener to prevent unhandled error event
      streamer.on('error', () => {});
      mockSession.emit('close');

      expect(streamer.isClosed).toBe(true);
      expect(streamer.isConnected).toBe(false);
    });

    it('should emit closed event on stream drop', async () => {
      await streamer.connect();
      // Add error listener to prevent unhandled error event
      streamer.on('error', () => {});
      const closedHandler = jest.fn();
      streamer.on('closed', closedHandler);

      mockSession.emit('close');

      expect(closedHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Transcript Events ─────────────────────────────────────────────────────

  describe('transcript events', () => {
    it('should emit transcript event when receiving transcript data', async () => {
      await streamer.connect();
      const transcriptHandler = jest.fn();
      streamer.on('transcript', transcriptHandler);

      const transcriptData = JSON.stringify({
        transcriptEvent: {
          segmentId: 'seg-1',
          content: 'The patient reports headaches.',
          participantRole: 'CLINICIAN',
          channelId: 0,
          startTime: 1.5,
          endTime: 3.2,
          isPartial: false,
        },
      }) + '\n';

      mockStream.emit('data', Buffer.from(transcriptData));

      expect(transcriptHandler).toHaveBeenCalledTimes(1);
      expect(transcriptHandler).toHaveBeenCalledWith({
        id: 'seg-1',
        content: 'The patient reports headaches.',
        speaker: 'CLINICIAN',
        channelId: 0,
        startTime: 1.5,
        endTime: 3.2,
        isPartial: false,
      });
    });

    it('should handle PATIENT speaker role', async () => {
      await streamer.connect();
      const transcriptHandler = jest.fn();
      streamer.on('transcript', transcriptHandler);

      const transcriptData = JSON.stringify({
        transcriptEvent: {
          segmentId: 'seg-2',
          content: 'I have been having headaches.',
          participantRole: 'PATIENT',
          channelId: 1,
          startTime: 3.5,
          endTime: 5.0,
          isPartial: false,
        },
      }) + '\n';

      mockStream.emit('data', Buffer.from(transcriptData));

      expect(transcriptHandler.mock.calls[0]![0].speaker).toBe('PATIENT');
    });

    it('should default to UNKNOWN for unrecognized speaker roles', async () => {
      await streamer.connect();
      const transcriptHandler = jest.fn();
      streamer.on('transcript', transcriptHandler);

      const transcriptData = JSON.stringify({
        transcriptEvent: {
          segmentId: 'seg-3',
          content: 'Some text',
          participantRole: 'OTHER',
          channelId: 0,
          startTime: 0,
          endTime: 1,
          isPartial: false,
        },
      }) + '\n';

      mockStream.emit('data', Buffer.from(transcriptData));

      expect(transcriptHandler.mock.calls[0]![0].speaker).toBe('UNKNOWN');
    });

    it('should handle multiple transcript events in a single data chunk', async () => {
      await streamer.connect();
      const transcriptHandler = jest.fn();
      streamer.on('transcript', transcriptHandler);

      const multiData =
        JSON.stringify({ transcriptEvent: { segmentId: 'seg-a', content: 'First', participantRole: 'CLINICIAN', channelId: 0, startTime: 0, endTime: 1, isPartial: false } }) + '\n' +
        JSON.stringify({ transcriptEvent: { segmentId: 'seg-b', content: 'Second', participantRole: 'PATIENT', channelId: 1, startTime: 1, endTime: 2, isPartial: false } }) + '\n';

      mockStream.emit('data', Buffer.from(multiData));

      expect(transcriptHandler).toHaveBeenCalledTimes(2);
    });

    it('should handle partial transcript data across multiple data events', async () => {
      await streamer.connect();
      const transcriptHandler = jest.fn();
      streamer.on('transcript', transcriptHandler);

      const fullMessage = JSON.stringify({
        transcriptEvent: {
          segmentId: 'seg-split',
          content: 'Split message',
          participantRole: 'CLINICIAN',
          channelId: 0,
          startTime: 0,
          endTime: 1,
          isPartial: false,
        },
      }) + '\n';

      // Split the message in half
      const half = Math.floor(fullMessage.length / 2);
      mockStream.emit('data', Buffer.from(fullMessage.slice(0, half)));
      expect(transcriptHandler).not.toHaveBeenCalled();

      mockStream.emit('data', Buffer.from(fullMessage.slice(half)));
      expect(transcriptHandler).toHaveBeenCalledTimes(1);
      expect(transcriptHandler.mock.calls[0]![0].id).toBe('seg-split');
    });

    it('should skip malformed JSON lines without crashing', async () => {
      await streamer.connect();
      const transcriptHandler = jest.fn();
      const errorHandler = jest.fn();
      streamer.on('transcript', transcriptHandler);
      streamer.on('error', errorHandler);

      const data = 'not valid json\n' +
        JSON.stringify({ transcriptEvent: { segmentId: 'seg-ok', content: 'Valid', participantRole: 'CLINICIAN', channelId: 0, startTime: 0, endTime: 1, isPartial: false } }) + '\n';

      mockStream.emit('data', Buffer.from(data));

      // Should still process the valid message
      expect(transcriptHandler).toHaveBeenCalledTimes(1);
      expect(transcriptHandler.mock.calls[0]![0].id).toBe('seg-ok');
      // Should not emit error for malformed JSON
      expect(errorHandler).not.toHaveBeenCalled();
    });
  });

  // ─── destroy() ─────────────────────────────────────────────────────────────

  describe('destroy()', () => {
    it('should close session and stream', async () => {
      await streamer.connect();
      streamer.destroy();

      expect(mockStream.close).toHaveBeenCalled();
      expect(mockSession.close).toHaveBeenCalled();
    });

    it('should mark as closed', async () => {
      await streamer.connect();
      streamer.destroy();

      expect(streamer.isClosed).toBe(true);
      expect(streamer.isConnected).toBe(false);
    });

    it('should be safe to call multiple times', async () => {
      await streamer.connect();
      streamer.destroy();
      streamer.destroy(); // Should not throw
    });

    it('should clear silence timer', async () => {
      await streamer.connect();
      const silenceHandler = jest.fn();
      streamer.on('silence', silenceHandler);

      streamer.destroy();
      jest.advanceTimersByTime(SILENCE_TIMEOUT_MS * 2);

      expect(silenceHandler).not.toHaveBeenCalled();
    });
  });

  // ─── Constants ─────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('should have SILENCE_TIMEOUT_MS set to 30000', () => {
      expect(SILENCE_TIMEOUT_MS).toBe(30_000);
    });

    it('should have MIN_TLS_VERSION set to TLSv1.2', () => {
      expect(MIN_TLS_VERSION).toBe('TLSv1.2');
    });
  });
});
