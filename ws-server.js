/**
 * WebSocket server for real-time audio streaming to Amazon Connect Health.
 *
 * Runs alongside the Next.js app on port 3001.
 * Browser connects, sends audio frames, receives transcript events.
 *
 * Protocol:
 * - Client sends JSON: { type: 'start', sessionId, domainId, subscriptionId, sampleRate }
 * - Client sends binary: raw PCM Int16 audio frames
 * - Client sends JSON: { type: 'end' }
 * - Server sends JSON: { type: 'transcript', id, content, channelId, isPartial }
 * - Server sends JSON: { type: 'complete' }
 * - Server sends JSON: { type: 'error', message }
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const {
  ConnectHealthClient,
  StartMedicalScribeListeningSessionCommand,
  MedicalScribeLanguageCode,
  MedicalScribeMediaEncoding,
  MedicalScribeParticipantRole,
  ManagedNoteTemplate,
} = require('@aws-sdk/client-connecthealth');

const WS_PORT = 3001;

// Create HTTP server for ALB health checks
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

const wss = new WebSocketServer({ server });
server.listen(WS_PORT, () => {
  console.log(`[WS] WebSocket server listening on port ${WS_PORT}`);
});

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  let session = null;
  let audioQueue = [];
  let audioResolve = null;
  let ended = false;
  let streamStarted = false;

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Binary = audio data
      const buffer = Buffer.from(data);
      audioQueue.push(buffer);
      if (audioResolve) {
        audioResolve();
        audioResolve = null;
      }
      return;
    }

    // Text = JSON control message
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'start') {
        session = {
          sessionId: msg.sessionId,
          domainId: msg.domainId,
          subscriptionId: msg.subscriptionId,
          sampleRate: msg.sampleRate || 16000,
        };
        console.log(`[WS] Starting stream for session ${session.sessionId} at ${session.sampleRate}Hz`);

        // Start the Connect Health stream
        startStream(ws, session).catch(err => {
          console.error(`[WS] Stream error:`, err.message);
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        });
        streamStarted = true;
      }

      if (msg.type === 'end') {
        console.log(`[WS] End signal received`);
        ended = true;
        if (audioResolve) {
          audioResolve();
          audioResolve = null;
        }
      }
    } catch (err) {
      console.error('[WS] Invalid message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    ended = true;
    if (audioResolve) {
      audioResolve();
      audioResolve = null;
    }
  });

  async function startStream(ws, session) {
    const region = process.env.AWS_REGION || 'us-east-1';
    const s3Bucket = process.env.S3_OUTPUT_BUCKET || '';
    const client = new ConnectHealthClient({ region });

    const inputStream = {
      async *[Symbol.asyncIterator]() {
        // 1. Configuration event
        yield {
          configurationEvent: {
            postStreamActionSettings: {
              outputS3Uri: `s3://${s3Bucket}/`,
              clinicalNoteGenerationSettings: {
                noteTemplateSettings: {
                  managedTemplate: {
                    templateType: ManagedNoteTemplate.PHYSICAL_SOAP,
                  },
                },
              },
            },
            channelDefinitions: [
              { channelId: 0, participantRole: MedicalScribeParticipantRole.CLINICIAN },
              { channelId: 1, participantRole: MedicalScribeParticipantRole.PATIENT },
            ],
          },
        };

        // 2. Audio chunks — continuous stream from WebSocket
        while (true) {
          while (audioQueue.length > 0) {
            const chunk = audioQueue.shift();
            yield { audioEvent: { audioChunk: chunk } };
          }
          if (ended) break;
          await new Promise(resolve => { audioResolve = resolve; });
        }

        // 3. END_OF_SESSION
        yield { sessionControlEvent: { type: 'END_OF_SESSION' } };
      },
    };

    console.log(`[WS] Starting Connect Health stream for ${session.sessionId}`);

    const command = new StartMedicalScribeListeningSessionCommand({
      sessionId: session.sessionId,
      domainId: session.domainId,
      subscriptionId: session.subscriptionId,
      languageCode: MedicalScribeLanguageCode.EN_US,
      mediaSampleRateHertz: session.sampleRate,
      mediaEncoding: MedicalScribeMediaEncoding.PCM,
      inputStream,
    });

    const response = await client.send(command);
    console.log(`[WS] Stream connected for ${session.sessionId}`);

    // Read transcript events and send to client
    if (response.responseStream) {
      for await (const event of response.responseStream) {
        if ('transcriptEvent' in event) {
          const seg = event.transcriptEvent?.transcriptSegment;
          if (seg && seg.content) {
            const msg = {
              type: 'transcript',
              id: seg.segmentId || `seg-${Date.now()}`,
              content: seg.content,
              channelId: seg.channelId || 'ch_0',
              startTime: seg.audioBeginOffset || 0,
              endTime: seg.audioEndOffset || 0,
              isPartial: seg.isPartial || false,
            };
            if (ws.readyState === 1) { // OPEN
              ws.send(JSON.stringify(msg));
            }
          }
        }
      }
    }

    console.log(`[WS] Stream completed for ${session.sessionId}`);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'complete' }));
    }
  }
});
