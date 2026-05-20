// Feature: ambient-clinical-documentation-demo, Property 7: WAV file parsing and streaming
// **Validates: Requirements 5.4**

import * as fc from 'fast-check';
import {
  parseWavHeader,
  TARGET_SAMPLE_RATE,
  TARGET_BIT_DEPTH,
  WAV_STREAM_INTERVAL_MS,
  CHUNK_SIZE,
} from './audio-capture';

/**
 * Builds a valid WAV file ArrayBuffer from raw PCM data.
 *
 * WAV file format (canonical):
 * - RIFF header (12 bytes): "RIFF" + file size + "WAVE"
 * - fmt chunk (24 bytes): "fmt " + chunk size + audio format fields
 * - data chunk (8 bytes header + PCM data): "data" + data size + raw PCM
 *
 * @param pcmData - Raw PCM audio data (16-bit samples)
 * @param sampleRate - Sample rate in Hz
 * @param numChannels - Number of audio channels
 * @param bitDepth - Bits per sample
 * @returns ArrayBuffer containing a valid WAV file
 */
function buildWavFile(
  pcmData: Uint8Array,
  sampleRate: number = TARGET_SAMPLE_RATE,
  numChannels: number = 1,
  bitDepth: number = TARGET_BIT_DEPTH
): ArrayBuffer {
  const dataSize = pcmData.length;
  const fmtChunkSize = 16; // PCM format chunk is always 16 bytes
  // Total file size: RIFF header (12) + fmt chunk (8 + 16) + data chunk (8 + dataSize)
  const fileSize = 4 + (8 + fmtChunkSize) + (8 + dataSize); // after "RIFF" + 4 bytes size
  const buffer = new ArrayBuffer(12 + (8 + fmtChunkSize) + (8 + dataSize));
  const view = new DataView(buffer);
  const byteRate = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign = numChannels * (bitDepth / 8);

  let offset = 0;

  // RIFF header
  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, fileSize, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;

  // fmt chunk
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, fmtChunkSize, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2; // AudioFormat = 1 (PCM)
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bitDepth, true); offset += 2;

  // data chunk
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;

  // Copy PCM data
  const uint8View = new Uint8Array(buffer);
  uint8View.set(pcmData, offset);

  return buffer;
}

/**
 * Writes an ASCII string into a DataView at the given offset.
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Arbitrary that generates valid PCM 16-bit audio data.
 * Generates an even number of bytes (since 16-bit = 2 bytes per sample).
 * Constrains size to keep tests fast while still exercising the property.
 */
const arbPcmData = fc
  .integer({ min: 1, max: 500 }) // number of samples (keep small for speed)
  .chain((numSamples) =>
    fc.uint8Array({ minLength: numSamples * 2, maxLength: numSamples * 2 })
  );

/**
 * Arbitrary that generates valid mono PCM data with the target sample rate.
 */
const arbValidWavPcmData = arbPcmData;

/**
 * Arbitrary that generates a valid number of channels (1 or 2).
 */
const arbNumChannels = fc.constantFrom(1, 2);

describe('Property 7: WAV file parsing and streaming', () => {
  describe('WAV file parsing correctly extracts audio data payload', () => {
    it('for any valid PCM 16-bit 16kHz WAV file, parseWavHeader extracts correct metadata', () => {
      fc.assert(
        fc.property(arbValidWavPcmData, arbNumChannels, (pcmData, numChannels) => {
          const wavBuffer = buildWavFile(pcmData, TARGET_SAMPLE_RATE, numChannels, TARGET_BIT_DEPTH);
          const header = parseWavHeader(wavBuffer);

          // Parser must successfully parse a valid WAV file
          expect(header).not.toBeNull();

          if (header) {
            // Sample rate must match
            expect(header.sampleRate).toBe(TARGET_SAMPLE_RATE);
            // Bit depth must match
            expect(header.bitDepth).toBe(TARGET_BIT_DEPTH);
            // Number of channels must match
            expect(header.numChannels).toBe(numChannels);
            // Data size must match the PCM data length
            expect(header.dataSize).toBe(pcmData.length);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('for any valid WAV file, the data at dataOffset with dataSize equals the original PCM data', () => {
      fc.assert(
        fc.property(arbValidWavPcmData, arbNumChannels, (pcmData, numChannels) => {
          const wavBuffer = buildWavFile(pcmData, TARGET_SAMPLE_RATE, numChannels, TARGET_BIT_DEPTH);
          const header = parseWavHeader(wavBuffer);

          expect(header).not.toBeNull();

          if (header) {
            // Extract the audio data from the WAV buffer using parsed header info
            const extractedData = new Uint8Array(wavBuffer, header.dataOffset, header.dataSize);

            // The extracted data must exactly equal the original PCM data
            expect(extractedData.length).toBe(pcmData.length);
            for (let i = 0; i < pcmData.length; i++) {
              expect(extractedData[i]).toBe(pcmData[i]);
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('WAV streaming emits chunks that concatenate to original PCM data', () => {
    it('for any valid WAV file, streaming chunks concatenated equal the original PCM data', () => {
      fc.assert(
        fc.property(arbValidWavPcmData, (pcmData) => {
          const wavBuffer = buildWavFile(pcmData, TARGET_SAMPLE_RATE, 1, TARGET_BIT_DEPTH);
          const header = parseWavHeader(wavBuffer);

          expect(header).not.toBeNull();

          if (header) {
            // Simulate the streaming logic from AudioCapture.startWavFile:
            // It reads pcmData from dataOffset with dataSize, then streams in chunks
            // based on bytesPerInterval = (sampleRate * (bitDepth/8) * numChannels * interval) / 1000
            const fullPcmData = new Uint8Array(wavBuffer, header.dataOffset, header.dataSize);
            const bytesPerSecond = header.sampleRate * (header.bitDepth / 8) * header.numChannels;
            const bytesPerInterval = Math.floor(
              (bytesPerSecond * WAV_STREAM_INTERVAL_MS) / 1000
            );

            // Collect all chunks that would be emitted
            const chunks: Uint8Array[] = [];
            let offset = 0;

            while (offset < fullPcmData.length) {
              const end = Math.min(offset + bytesPerInterval, fullPcmData.length);
              const chunk = fullPcmData.slice(offset, end);
              chunks.push(chunk);
              offset = end;
            }

            // Concatenate all chunks
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const concatenated = new Uint8Array(totalLength);
            let writeOffset = 0;
            for (const chunk of chunks) {
              concatenated.set(chunk, writeOffset);
              writeOffset += chunk.length;
            }

            // The concatenated chunks must equal the original PCM data
            expect(concatenated.length).toBe(pcmData.length);
            for (let i = 0; i < pcmData.length; i++) {
              expect(concatenated[i]).toBe(pcmData[i]);
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it('for any valid stereo WAV file, streaming chunks concatenated equal the original PCM data', () => {
      fc.assert(
        fc.property(
          // Generate even-length PCM data for stereo (4 bytes per frame: 2 channels * 2 bytes)
          fc.integer({ min: 1, max: 250 }).chain((numFrames) =>
            fc.uint8Array({ minLength: numFrames * 4, maxLength: numFrames * 4 })
          ),
          (pcmData) => {
            const numChannels = 2;
            const wavBuffer = buildWavFile(pcmData, TARGET_SAMPLE_RATE, numChannels, TARGET_BIT_DEPTH);
            const header = parseWavHeader(wavBuffer);

            expect(header).not.toBeNull();

            if (header) {
              const fullPcmData = new Uint8Array(wavBuffer, header.dataOffset, header.dataSize);
              const bytesPerSecond = header.sampleRate * (header.bitDepth / 8) * header.numChannels;
              const bytesPerInterval = Math.floor(
                (bytesPerSecond * WAV_STREAM_INTERVAL_MS) / 1000
              );

              // Collect all chunks
              const chunks: Uint8Array[] = [];
              let offset = 0;

              while (offset < fullPcmData.length) {
                const end = Math.min(offset + bytesPerInterval, fullPcmData.length);
                const chunk = fullPcmData.slice(offset, end);
                chunks.push(chunk);
                offset = end;
              }

              // Concatenate all chunks
              const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
              const concatenated = new Uint8Array(totalLength);
              let writeOffset = 0;
              for (const chunk of chunks) {
                concatenated.set(chunk, writeOffset);
                writeOffset += chunk.length;
              }

              // The concatenated chunks must equal the original PCM data
              expect(concatenated.length).toBe(pcmData.length);
              for (let i = 0; i < pcmData.length; i++) {
                expect(concatenated[i]).toBe(pcmData[i]);
              }
            }
          }
        ),
        { numRuns: 100 },
      );
    });

    it('each emitted chunk has size <= bytesPerInterval (except possibly the last chunk)', () => {
      fc.assert(
        fc.property(arbValidWavPcmData, arbNumChannels, (pcmData, numChannels) => {
          const wavBuffer = buildWavFile(pcmData, TARGET_SAMPLE_RATE, numChannels, TARGET_BIT_DEPTH);
          const header = parseWavHeader(wavBuffer);

          expect(header).not.toBeNull();

          if (header) {
            const fullPcmData = new Uint8Array(wavBuffer, header.dataOffset, header.dataSize);
            const bytesPerSecond = header.sampleRate * (header.bitDepth / 8) * header.numChannels;
            const bytesPerInterval = Math.floor(
              (bytesPerSecond * WAV_STREAM_INTERVAL_MS) / 1000
            );

            // Collect all chunks
            const chunks: Uint8Array[] = [];
            let offset = 0;

            while (offset < fullPcmData.length) {
              const end = Math.min(offset + bytesPerInterval, fullPcmData.length);
              const chunk = fullPcmData.slice(offset, end);
              chunks.push(chunk);
              offset = end;
            }

            // All chunks except possibly the last must be exactly bytesPerInterval
            for (let i = 0; i < chunks.length - 1; i++) {
              expect(chunks[i].length).toBe(bytesPerInterval);
            }

            // The last chunk must be <= bytesPerInterval
            if (chunks.length > 0) {
              expect(chunks[chunks.length - 1].length).toBeLessThanOrEqual(bytesPerInterval);
              expect(chunks[chunks.length - 1].length).toBeGreaterThan(0);
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
