import { http, HttpResponse } from 'msw';

/**
 * MSW request handlers for S3 mocking in tests.
 * Mocks GetObject responses for clinical notes, transcripts, and after-visit summaries.
 *
 * S3 output path structure:
 *   s3://{bucket}/health-agent-listening-session/{domainId}/{subscriptionId}/{sessionId}/post-stream-action/
 *     - clinical-notes/  (JSON clinical note with evidence map)
 *     - transcript/      (JSON transcript segments)
 *     - after-visit-summary/  (plain text AVS)
 */
export const s3Handlers = [
  // S3 GetObject - Clinical Note
  http.get(
    'https://*.s3.*.amazonaws.com/health-agent-listening-session/*/post-stream-action/clinical-notes/*',
    () => {
      return HttpResponse.json({
        sections: [
          { heading: 'Subjective', content: 'Patient reports persistent fatigue for the past two weeks.' },
          { heading: 'Objective', content: 'Vitals: BP 120/80, HR 72, Temp 98.6F. BMI 28.' },
          { heading: 'Assessment', content: 'Type 2 Diabetes Mellitus, well-controlled. Fatigue likely related to medication adjustment.' },
          { heading: 'Plan', content: 'Continue Metformin 500mg. Order HbA1c and CBC. Follow up in 4 weeks.' },
        ],
        evidenceMap: [
          {
            noteStatementId: 'stmt-1',
            noteStatement: 'Patient reports persistent fatigue for the past two weeks.',
            sourceType: 'transcript',
            transcriptReference: {
              startTime: 4.0,
              endTime: 8.2,
              content: 'I have been feeling really tired lately.',
            },
          },
          {
            noteStatementId: 'stmt-2',
            noteStatement: 'Type 2 Diabetes Mellitus, well-controlled.',
            sourceType: 'patient_context',
          },
        ],
      });
    }
  ),

  // S3 GetObject - After-Visit Summary
  http.get(
    'https://*.s3.*.amazonaws.com/health-agent-listening-session/*/post-stream-action/after-visit-summary/*',
    () => {
      return HttpResponse.text(
        'Your visit summary:\n\n' +
        'We discussed your diabetes management today. You mentioned feeling tired for the past two weeks.\n\n' +
        'Next steps:\n' +
        '- Continue taking Metformin 500mg twice daily\n' +
        '- Blood tests ordered: HbA1c and CBC\n' +
        '- Follow-up appointment in 4 weeks\n\n' +
        'If your fatigue worsens or you develop new symptoms, please contact our office.'
      );
    }
  ),

  // S3 GetObject - Transcript
  http.get(
    'https://*.s3.*.amazonaws.com/health-agent-listening-session/*/post-stream-action/transcript/*',
    () => {
      return HttpResponse.json({
        segments: [
          {
            id: 'seg-1',
            content: 'Good morning. How are you feeling today?',
            speaker: 'CLINICIAN',
            channelId: 0,
            startTime: 0,
            endTime: 3.5,
            isPartial: false,
          },
          {
            id: 'seg-2',
            content: 'I have been feeling really tired lately.',
            speaker: 'PATIENT',
            channelId: 1,
            startTime: 4.0,
            endTime: 8.2,
            isPartial: false,
          },
          {
            id: 'seg-3',
            content: 'How long has this been going on?',
            speaker: 'CLINICIAN',
            channelId: 0,
            startTime: 9.0,
            endTime: 12.0,
            isPartial: false,
          },
          {
            id: 'seg-4',
            content: 'About two weeks now. It started after you changed my medication.',
            speaker: 'PATIENT',
            channelId: 1,
            startTime: 12.5,
            endTime: 17.0,
            isPartial: false,
          },
        ],
      });
    }
  ),
];
