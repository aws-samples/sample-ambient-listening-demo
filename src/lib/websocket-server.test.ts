/**
 * Unit tests for the WebSocket audio streaming server.
 *
 * Tests the WebSocketAudioHandler class and createWebSocketServer function.
 * Uses mocked WebSocket and AudioStreamer to test the bridging logic.
 */

import { EventEmitter } from 'events';
import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';

import { WebSocketAudioHandler, createWebSocketServer } from './websocket-server';
import { AudioStreamer } from './audio-streamer';
import { SessionManager } from './session-manager';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('./audio-streamer');

const MockedAudioStreamer = AudioStreamer as jest.MockedClass<typeof AudioStreamer>;

/**
 * Creates a mock WebSocket with EventEmitter capabilities.
 */
function createMockWebSocket(): WebSocket & { sentMessages: string[] } {
  const emitter = new EventEmitter();
  const sentMessages: string[] = [];

  const mockWs = Object.assign(emitter, {
    readyState: WebSocket.OPEN,
    send: jest.fn((data: string) => {
      sentMessages.push(data);
    }),
    close: jest.fn(),
    ping: jest.fn(),
    sentMessages,
    OPEN: WebSocket.OPEN,
    CLOSED: WebSocket.CLOSED,
  }) as unknown as WebSocket & { sentMessages: string[] };

  return mockWs;
}

/**
 * Creates a mock SessionManager with a configurable session lookup.
 */
function createMockSessionManager(sessions: Record<string, { status: string; sessionId: string; outputS3Uri: string }>): SessionManager {
  const manager = {
    getSession: jest.fn((sessionId: string) => {
      const session = sessions[sessionId];
      if (!session) return undefined;
      return {
        sessionId: session.sessionId,
        domainId: 'domain-1',
        subscriptionId: 'sub-1',
        status: session.status,
        patientId: 'patient-1',
        patientContext: 'test context',
        outputS3Uri: session.outputS3Uri,
        startedAt: new Date(),
      };
    }),
  } as unknown as SessionManager;

  return manager;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WebSocketAudioHandler', () => {
  let mockWs: WebSocket & { sentMessages: string[] };
  let mockSessionManager: SessionManager;
  let mockAudioStreamerInstance: EventEmitter & {
    connect: jest.Mock;
    sendAudioChunk: jest.Mock;
    endStream: jest.Mock;
    destroy: jest.Mock;
    removeAllListeners: jest.Mock;
    isConnected: boolean;
    isClosed: boolean;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockWs = createMockWebSocket();
    mockSessionManager = createMockSessionManager({
      'session-123': {
        status: 'active',
        sessionId: 'session-123',
        outputS3Uri: 'https://connect-health.us-east-1.amazonaws.com/stream',
      },
    });

    // Set up the mocked AudioStreamer instance
    mockAudioStreamerInstance = Object.assign(new EventEmitter(), {
      connect: jest.fn().mockResolvedValue(undefined),
      sendAudioChunk: jest.fn(),
      endStream: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      removeAllListeners: jest.fn(),
      isConnected: true,
      isClosed: false,
    });

    MockedAudioStreamer.mockImplementation(() => mockAudioStreamerInstance as unknown as AudioStreamer);
  });

  it('should create an AudioStreamer and connect when session is active', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    // Wait for async initialization
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(MockedAudioStreamer).toHaveBeenCalledWith({
      streamUrl: 'https://connect-health.us-east-1.amazonaws.com/stream',
      sessionId: 'session-123',
    });
    expect(mockAudioStreamerInstance.connect).toHaveBeenCalled();
  });

  it('should send connected message after successful AudioStreamer connection', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    const messages = mockWs.sentMessages.map(m => JSON.parse(m));
    expect(messages).toContainEqual({ type: 'connected' });
  });

  it('should send error and close WebSocket when session is not found', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'nonexistent', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    const messages = mockWs.sentMessages.map(m => JSON.parse(m));
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({
        code: 'SESSION_NOT_FOUND',
      }),
    }));
    expect(mockWs.close).toHaveBeenCalledWith(4004, 'Session not found');
  });

  it('should send error and close WebSocket when session is not active', async () => {
    const manager = createMockSessionManager({
      'session-456': {
        status: 'ended',
        sessionId: 'session-456',
        outputS3Uri: 'https://example.com/stream',
      },
    });

    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-456', manager);

    await new Promise(resolve => setTimeout(resolve, 10));

    const messages = mockWs.sentMessages.map(m => JSON.parse(m));
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({
        code: 'SESSION_NOT_ACTIVE',
      }),
    }));
    expect(mockWs.close).toHaveBeenCalledWith(4003, 'Session not active');
  });

  it('should forward binary audio chunks to the AudioStreamer', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    const audioChunk = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    mockWs.emit('message', audioChunk, true);

    expect(mockAudioStreamerInstance.sendAudioChunk).toHaveBeenCalledWith(audioChunk);
  });

  it('should forward transcript events from AudioStreamer to WebSocket client', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    const segment = {
      id: 'seg-1',
      content: 'Hello doctor',
      speaker: 'PATIENT' as const,
      channelId: 1,
      startTime: 0,
      endTime: 1.5,
      isPartial: false,
    };

    mockAudioStreamerInstance.emit('transcript', segment);

    const messages = mockWs.sentMessages.map(m => JSON.parse(m));
    expect(messages).toContainEqual({ type: 'transcript', data: segment });
  });

  it('should forward error events from AudioStreamer to WebSocket client', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    const error = {
      code: 'STREAM_DROP',
      message: 'Connection lost',
      retryable: true,
    };

    mockAudioStreamerInstance.emit('error', error);

    const messages = mockWs.sentMessages.map(m => JSON.parse(m));
    expect(messages).toContainEqual({ type: 'error', data: error });
  });

  it('should forward silence events from AudioStreamer to WebSocket client', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    mockAudioStreamerInstance.emit('silence');

    const messages = mockWs.sentMessages.map(m => JSON.parse(m));
    expect(messages).toContainEqual({ type: 'silence' });
  });

  it('should handle end_session control message', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    const controlMessage = JSON.stringify({ type: 'end_session' });
    mockWs.emit('message', controlMessage, false);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockAudioStreamerInstance.endStream).toHaveBeenCalled();
  });

  it('should cleanup AudioStreamer when WebSocket closes', async () => {
    const handler = new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    mockWs.emit('close', 1000, Buffer.from('Normal closure'));

    expect(mockAudioStreamerInstance.destroy).toHaveBeenCalled();
    expect(handler.isCleanedUp).toBe(true);
  });

  it('should cleanup AudioStreamer when WebSocket errors', async () => {
    const handler = new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    mockWs.emit('error', new Error('Connection reset'));

    expect(mockAudioStreamerInstance.destroy).toHaveBeenCalled();
    expect(handler.isCleanedUp).toBe(true);
  });

  it('should not forward audio chunks after cleanup', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Trigger cleanup
    mockWs.emit('close', 1000, Buffer.from(''));

    // Try to send audio after cleanup
    const audioChunk = Buffer.from([0x01, 0x02]);
    mockWs.emit('message', audioChunk, true);

    // sendAudioChunk should not be called after cleanup
    expect(mockAudioStreamerInstance.sendAudioChunk).not.toHaveBeenCalled();
  });

  it('should ignore malformed JSON control messages', async () => {
    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Send malformed JSON — should not throw
    mockWs.emit('message', 'not valid json{{{', false);

    // No error should be sent for malformed control messages
    const messages = mockWs.sentMessages.map(m => JSON.parse(m));
    const errorMessages = messages.filter(m => m.type === 'error');
    expect(errorMessages).toHaveLength(0);
  });

  it('should send error when AudioStreamer connection fails', async () => {
    mockAudioStreamerInstance.connect = jest.fn().mockRejectedValue(new Error('Connection refused'));

    new WebSocketAudioHandler(mockWs as unknown as WebSocket, 'session-123', mockSessionManager);

    await new Promise(resolve => setTimeout(resolve, 10));

    const messages = mockWs.sentMessages.map(m => JSON.parse(m));
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({
        code: 'STREAMER_CONNECT_FAILED',
        retryable: true,
      }),
    }));
  });
});

describe('createWebSocketServer', () => {
  let server: http.Server;
  let sessionManager: SessionManager;
  let wss: WebSocketServer;

  beforeEach(() => {
    server = http.createServer();
    sessionManager = createMockSessionManager({
      'session-abc': {
        status: 'active',
        sessionId: 'session-abc',
        outputS3Uri: 'https://connect-health.us-east-1.amazonaws.com/stream',
      },
    });
  });

  afterEach((done) => {
    if (wss) {
      wss.close();
    }
    server.close(done);
  });

  it('should create a WebSocketServer instance', (done) => {
    wss = createWebSocketServer(server, sessionManager);
    expect(wss).toBeInstanceOf(WebSocketServer);
    // Start and immediately stop the server to satisfy afterEach cleanup
    server.listen(0, () => {
      done();
    });
  });

  it('should accept connections on /ws/audio/:sessionId path', (done) => {
    wss = createWebSocketServer(server, sessionManager);

    server.listen(0, () => {
      const address = server.address() as { port: number };
      const client = new WebSocket(`ws://localhost:${address.port}/ws/audio/session-abc`);

      client.on('open', () => {
        // Connection was accepted
        client.close();
      });

      client.on('close', () => {
        done();
      });

      client.on('error', (err) => {
        done(err);
      });
    });
  });

  it('should reject connections on invalid paths', (done) => {
    wss = createWebSocketServer(server, sessionManager);

    server.listen(0, () => {
      const address = server.address() as { port: number };
      const client = new WebSocket(`ws://localhost:${address.port}/invalid/path`);

      client.on('error', () => {
        // Expected — connection rejected
        done();
      });

      client.on('open', () => {
        client.close();
        done(new Error('Should not have connected on invalid path'));
      });
    });
  });
});
