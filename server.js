/**
 * Custom server that runs Next.js + WebSocket on the same port (3000).
 * Handles WebSocket upgrades on the /ws path.
 *
 * RESPONSIBLE AI NOTICE:
 * This server streams audio to Amazon Connect Health Medical Scribe and relays
 * transcript events back to the client. AI-generated transcripts and clinical notes
 * are assistive outputs that require clinician review before use in patient care.
 * The clinician must review, edit, and approve all AI-generated content before
 * it is written back to the patient's medical record.
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');

// Import Connect Health SDK
const {
  ConnectHealthClient,
  StartMedicalScribeListeningSessionCommand,
  MedicalScribeLanguageCode,
  MedicalScribeMediaEncoding,
  MedicalScribeParticipantRole,
  ManagedNoteTemplate,
} = require('@aws-sdk/client-connecthealth');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // WebSocket server on /ws path
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

  // Handle WebSocket connections
  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');

    let audioQueue = [];
    let audioResolve = null;
    let ended = false;
    let session = null;

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
          session = msg;
          console.log(`[WS] Starting stream for ${session.sessionId} at ${session.sampleRate}Hz`);
          startConnectHealthStream(ws, session, audioQueue, () => audioResolve, (r) => { audioResolve = r; }, () => ended)
            .catch(err => {
              console.error(`[WS] Stream error:`, err.message);
              if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: err.message }));
            });
        }

        if (msg.type === 'end') {
          console.log(`[WS] End signal`);
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
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket available on port ${port}/ws (TLS terminated at ALB)`);
  });
});

async function startConnectHealthStream(ws, session, audioQueue, getResolve, setResolve, isEnded) {
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

      // 2. Audio chunks
      while (true) {
        while (audioQueue.length > 0) {
          yield { audioEvent: { audioChunk: audioQueue.shift() } };
        }
        if (isEnded()) break;
        await new Promise(resolve => setResolve(resolve));
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
    mediaSampleRateHertz: session.sampleRate || 16000,
    mediaEncoding: MedicalScribeMediaEncoding.PCM,
    inputStream,
  });

  const response = await client.send(command);
  console.log(`[WS] Stream connected for ${session.sessionId}`);

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

  console.log(`[WS] Stream completed for ${session.sessionId}`);
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'complete' }));
}
