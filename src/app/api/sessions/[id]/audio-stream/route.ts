/**
 * POST /api/sessions/[id]/audio-stream — Stream audio and receive transcripts.
 *
 * Each request sends an audio chunk and receives back any new transcript segments.
 * On the first chunk, starts the Connect Health streaming session.
 *
 * Headers:
 *   x-action: 'chunk' | 'end'
 *   x-domain-id: domain ID (required on first chunk)
 *   x-subscription-id: subscription ID (required on first chunk)
 *   x-patient-context: patient context text (optional, on first chunk)
 *
 * Response: { status, transcripts: [...] }
 */

import { NextResponse } from 'next/server';
import {
  ConnectHealthClient,
  StartMedicalScribeListeningSessionCommand,
  MedicalScribeLanguageCode,
  MedicalScribeMediaEncoding,
  MedicalScribeParticipantRole,
  ManagedNoteTemplate,
} from '@aws-sdk/client-connecthealth';
import type { MedicalScribeInputStream } from '@aws-sdk/client-connecthealth';

// ─── In-process session state ────────────────────────────────────────────────
// This works because audio-stream is the ONLY route that accesses this state.

interface SessionState {
  domainId: string;
  subscriptionId: string;
  patientContext: string;
  audioQueue: Buffer[];
  audioResolve: (() => void) | null;
  ended: boolean;
  transcripts: any[];
  streamStarted: boolean;
  streamError: string | null;
  sampleRate: number;
}

const sessions = new Map<string, SessionState>();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const action = request.headers.get('x-action') || 'chunk';

  if (action === 'end') {
    const session = sessions.get(sessionId);
    if (session) {
      session.ended = true;
      if (session.audioResolve) {
        session.audioResolve();
        session.audioResolve = null;
      }
    }
    return NextResponse.json({ status: 'ended', transcripts: [] });
  }

  // Read audio data
  const audioData = Buffer.from(await request.arrayBuffer());
  if (audioData.length === 0) {
    const session = sessions.get(sessionId);
    const transcripts = session ? session.transcripts.splice(0) : [];
    return NextResponse.json({ status: 'ok', bytes: 0, transcripts });
  }

  // Register session on first chunk
  let session = sessions.get(sessionId);
  if (!session) {
    const domainId = request.headers.get('x-domain-id') || '';
    const subscriptionId = request.headers.get('x-subscription-id') || '';
    const patientContext = ''; // Patient context is passed via the session creation API, not headers
    const sampleRate = parseInt(request.headers.get('x-sample-rate') || '16000', 10);

    if (!domainId || !subscriptionId) {
      return NextResponse.json(
        { code: 'MISSING_HEADERS', message: 'First chunk must include x-domain-id and x-subscription-id' },
        { status: 400 }
      );
    }

    session = {
      domainId,
      subscriptionId,
      patientContext,
      audioQueue: [],
      audioResolve: null,
      ended: false,
      transcripts: [],
      streamStarted: false,
      streamError: null,
      sampleRate,
    };
    sessions.set(sessionId, session);
  }

  // Push audio into queue
  session.audioQueue.push(audioData);
  console.log(`[AudioStream] Pushed ${audioData.length} bytes for ${sessionId}, queue size: ${session.audioQueue.length}, streamStarted: ${session.streamStarted}`);
  if (session.audioResolve) {
    session.audioResolve();
    session.audioResolve = null;
  }

  // Start Connect Health stream on first chunk
  if (!session.streamStarted) {
    session.streamStarted = true;
    console.log(`[AudioStream] First chunk for ${sessionId}, starting stream...`);

    const region = process.env.AWS_REGION || 'us-east-1';
    const s3Bucket = process.env.S3_OUTPUT_BUCKET || '';
    const client = new ConnectHealthClient({ region });

    startStream(client, sessionId, session, s3Bucket).catch(err => {
      console.error(`[AudioStream] Stream error:`, err instanceof Error ? err.message : 'Unknown error');
      session!.streamError = err instanceof Error ? err.message : 'Stream failed';
    });
  }

  // Return any accumulated transcripts
  const transcripts = session.transcripts.splice(0);
  return NextResponse.json({
    status: 'ok',
    bytes: audioData.length,
    transcripts,
    error: session.streamError,
  });
}

// ─── Connect Health Stream ───────────────────────────────────────────────────

async function startStream(
  client: ConnectHealthClient,
  sessionId: string,
  session: SessionState,
  s3Bucket: string
): Promise<void> {
  const inputStream: AsyncIterable<MedicalScribeInputStream> = {
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
          ...(session.patientContext ? { encounterContext: { unstructuredContext: session.patientContext } } : {}),
        },
      } as MedicalScribeInputStream;

      // 2. Audio chunks
      while (true) {
        while (session.audioQueue.length > 0) {
          const chunk = session.audioQueue.shift()!;
          console.log(`[AudioStream] Yielding audio chunk: ${chunk.length} bytes`);
          yield { audioEvent: { audioChunk: chunk } } as MedicalScribeInputStream;
        }
        if (session.ended) break;
        console.log(`[AudioStream] Waiting for more audio...`);
        await new Promise<void>(resolve => { session.audioResolve = resolve; });
        console.log(`[AudioStream] Woke up, queue size: ${session.audioQueue.length}`);
      }

      // 3. END_OF_SESSION
      yield { sessionControlEvent: { type: 'END_OF_SESSION' } } as MedicalScribeInputStream;
    },
  };

  console.log(`[AudioStream] Starting Connect Health stream for ${sessionId}`);

  const command = new StartMedicalScribeListeningSessionCommand({
    sessionId,
    domainId: session.domainId,
    subscriptionId: session.subscriptionId,
    languageCode: MedicalScribeLanguageCode.EN_US,
    mediaSampleRateHertz: session.sampleRate,
    mediaEncoding: MedicalScribeMediaEncoding.PCM,
    inputStream,
  });

  const response = await client.send(command);
  console.log(`[AudioStream] Stream connected for ${sessionId}`);

  // Read transcript events and store them
  if (response.responseStream) {
    for await (const event of response.responseStream) {
      if ('transcriptEvent' in event) {
        const seg = (event as any).transcriptEvent?.transcriptSegment;
        if (seg && seg.content) {
          session.transcripts.push({
            id: seg.segmentId || `seg-${Date.now()}`,
            content: seg.content,
            channelId: seg.channelId || 'ch_0',
            startTime: seg.audioBeginOffset || 0,
            endTime: seg.audioEndOffset || 0,
            isPartial: seg.isPartial || false,
          });
        }
      }
    }
  }

  console.log(`[AudioStream] Stream completed for ${sessionId}`);
  // Clean up after delay
  setTimeout(() => sessions.delete(sessionId), 120_000);
}
