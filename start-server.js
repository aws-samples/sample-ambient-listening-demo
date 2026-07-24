/**
 * Entrypoint that adds WebSocket support to the Next.js standalone server.
 * Monkey-patches http.createServer to intercept the server instance,
 * then attaches a WebSocket server for /ws path upgrades.
 * Everything runs on port 3000 — no separate port needed.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const {
  ConnectHealthClient,
  StartMedicalScribeListeningSessionCommand,
  MedicalScribeLanguageCode,
  MedicalScribeMediaEncoding,
  MedicalScribeParticipantRole,
  ManagedNoteTemplate,
} = require('@aws-sdk/client-connecthealth');
const { parse } = require('url');

// Monkey-patch http.createServer to capture the server instance
const originalCreateServer = http.createServer;
http.createServer = function (...args) {
  const server = originalCreateServer.apply(this, args);

  // Attach WebSocket server (noServer mode — we handle upgrades manually)
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url);
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', handleWebSocketConnection);

  console.log('[WS] WebSocket handler attached to port 3000 at /ws');
  return server;
};

// Now load the Next.js standalone server (it will use our patched createServer)
require('./server.js');

// ─── WebSocket Connection Handler ────────────────────────────────────────────

function handleWebSocketConnection(ws) {
  console.log('[WS] Client connected');

  let audioQueue = [];
  let audioResolve = null;
  let ended = false;

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      audioQueue.push(Buffer.from(data));
      if (audioResolve) {
        audioResolve();
        audioResolve = null;
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'start') {
        console.log(`[WS] Starting stream at ${msg.sampleRate}Hz`);
        startConnectHealthStream(ws, msg, audioQueue, () => ended, (r) => { audioResolve = r; })
          .catch(err => {
            console.error(`[WS] Stream error:`, err.message);
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: err.message }));
          });
      }

      if (msg.type === 'end') {
        console.log(`[WS] End signal received`);
        ended = true;
        if (audioResolve) { audioResolve(); audioResolve = null; }
      }
    } catch (err) {
      console.error('[WS] Invalid message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    ended = true;
    if (audioResolve) { audioResolve(); audioResolve = null; }
  });
}

// ─── Connect Health Streaming ────────────────────────────────────────────────

async function startConnectHealthStream(ws, session, audioQueue, isEnded, setResolve) {
  const region = process.env.AWS_REGION || 'us-east-1';
  const s3Bucket = process.env.S3_OUTPUT_BUCKET || '';
  const client = new ConnectHealthClient({ region });

  // Generate silence padding: 5 seconds of zero-valued PCM at the session's sample rate.
  // This gives Connect Health time to warm up its transcription engine before real speech arrives.
  const sampleRate = session.sampleRate || 48000;
  const SILENCE_DURATION_SEC = 5;
  const SILENCE_CHUNK_SIZE = 4096; // samples per chunk (matches client's ScriptProcessorNode buffer)
  const totalSilenceSamples = sampleRate * SILENCE_DURATION_SEC;
  const silenceChunksCount = Math.ceil(totalSilenceSamples / SILENCE_CHUNK_SIZE);

  const inputStream = {
    async *[Symbol.asyncIterator]() {
      // 1. Configuration event
      yield {
        configurationEvent: {
          postStreamActionSettings: {
            outputS3Uri: `s3://${s3Bucket}/`,
            clinicalNoteGenerationSettings: {
              noteTemplateSettings: {
                managedTemplate: { templateType: ManagedNoteTemplate.PHYSICAL_SOAP },
              },
            },
          },
          channelDefinitions: [
            { channelId: 0, participantRole: MedicalScribeParticipantRole.CLINICIAN },
            { channelId: 1, participantRole: MedicalScribeParticipantRole.PATIENT },
          ],
        },
      };

      // 2. Silence padding — warm up the transcription engine
      console.log(`[WS] Sending ${SILENCE_DURATION_SEC}s silence padding (${silenceChunksCount} chunks)`);
      for (let i = 0; i < silenceChunksCount; i++) {
        const silenceBuffer = Buffer.alloc(SILENCE_CHUNK_SIZE * 2); // 2 bytes per Int16 sample
        yield { audioEvent: { audioChunk: silenceBuffer } };
      }
      console.log(`[WS] Silence padding complete, draining audio queue (${audioQueue.length} chunks buffered)`);

      // 3. Real audio chunks from the client
      while (true) {
        while (audioQueue.length > 0) {
          yield { audioEvent: { audioChunk: audioQueue.shift() } };
        }
        if (isEnded()) break;
        await new Promise(resolve => setResolve(resolve));
      }

      // 4. END_OF_SESSION
      yield { sessionControlEvent: { type: 'END_OF_SESSION' } };
    },
  };

  console.log(`[WS] Starting Connect Health stream`);

  const command = new StartMedicalScribeListeningSessionCommand({
    sessionId: session.sessionId,
    domainId: session.domainId,
    subscriptionId: session.subscriptionId,
    languageCode: MedicalScribeLanguageCode.EN_US,
    mediaSampleRateHertz: session.sampleRate || 48000,
    mediaEncoding: MedicalScribeMediaEncoding.PCM,
    inputStream,
  });

  const response = await client.send(command);
  console.log(`[WS] Stream connected`);

  // Notify client that stream is ready — client will flush buffered audio
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ready' }));

  if (response.responseStream) {
    for await (const event of response.responseStream) {
      if ('transcriptEvent' in event) {
        const seg = event.transcriptEvent?.transcriptSegment;
        if (seg && seg.content && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'transcript',
            id: seg.segmentId || `seg-${Date.now()}`,
            content: seg.content,
            channelId: seg.channelId || 'ch_0',
            startTime: seg.audioBeginOffset || 0,
            endTime: seg.audioEndOffset || 0,
            isPartial: seg.isPartial || false,
          }));
        }
      }
    }
  }

  console.log(`[WS] Stream completed`);
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'complete' }));
}
