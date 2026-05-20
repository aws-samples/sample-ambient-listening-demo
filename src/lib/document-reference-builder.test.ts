/**
 * Unit tests for DocumentReference builder.
 *
 * @see Requirements 14.2
 */

import { buildDocumentReference } from './document-reference-builder';
import type { DocumentReferenceCreate } from '../types';

describe('buildDocumentReference', () => {
  const defaultParams = {
    clinicalNoteContent: 'Subjective: Patient reports headache.\nObjective: BP 120/80.',
    patientId: '12345',
    sessionDate: new Date('2024-03-15T10:30:00.000Z'),
  };

  describe('resource structure', () => {
    it('should return a DocumentReference with resourceType set', () => {
      const result = buildDocumentReference(defaultParams);
      expect(result.resourceType).toBe('DocumentReference');
    });

    it('should set status to current', () => {
      const result = buildDocumentReference(defaultParams);
      expect(result.status).toBe('current');
    });

    it('should set LOINC type coding for progress note', () => {
      const result = buildDocumentReference(defaultParams);
      expect(result.type.coding).toHaveLength(1);
      expect(result.type.coding[0]).toEqual({
        system: 'http://loinc.org',
        code: '11506-3',
        display: 'Progress note',
      });
    });
  });

  describe('subject reference', () => {
    it('should set subject reference with Patient/ prefix', () => {
      const result = buildDocumentReference(defaultParams);
      expect(result.subject.reference).toBe('Patient/12345');
    });

    it('should handle various patient ID formats', () => {
      const result = buildDocumentReference({
        ...defaultParams,
        patientId: 'abc-def-123',
      });
      expect(result.subject.reference).toBe('Patient/abc-def-123');
    });
  });

  describe('date handling', () => {
    it('should set date in ISO 8601 format from Date object', () => {
      const result = buildDocumentReference(defaultParams);
      expect(result.date).toBe('2024-03-15T10:30:00.000Z');
    });

    it('should accept ISO string as session date', () => {
      const result = buildDocumentReference({
        ...defaultParams,
        sessionDate: '2024-06-20T14:00:00.000Z',
      });
      expect(result.date).toBe('2024-06-20T14:00:00.000Z');
    });

    it('should format description with YYYY-MM-DD date', () => {
      const result = buildDocumentReference(defaultParams);
      expect(result.description).toBe('Ambient Clinical Note - 2024-03-15');
    });

    it('should handle different dates in description', () => {
      const result = buildDocumentReference({
        ...defaultParams,
        sessionDate: new Date('2025-01-01T00:00:00.000Z'),
      });
      expect(result.description).toBe('Ambient Clinical Note - 2025-01-01');
    });
  });

  describe('content attachment', () => {
    it('should have exactly one content entry', () => {
      const result = buildDocumentReference(defaultParams);
      expect(result.content).toHaveLength(1);
    });

    it('should set contentType to text/plain', () => {
      const result = buildDocumentReference(defaultParams);
      expect(result.content[0].attachment.contentType).toBe('text/plain');
    });

    it('should base64-encode the clinical note content', () => {
      const result = buildDocumentReference(defaultParams);
      const decoded = Buffer.from(result.content[0].attachment.data, 'base64').toString('utf-8');
      expect(decoded).toBe(defaultParams.clinicalNoteContent);
    });

    it('should handle empty clinical note content', () => {
      const result = buildDocumentReference({
        ...defaultParams,
        clinicalNoteContent: '',
      });
      const decoded = Buffer.from(result.content[0].attachment.data, 'base64').toString('utf-8');
      expect(decoded).toBe('');
    });

    it('should handle clinical note with special characters', () => {
      const noteWithSpecialChars = 'Patient says: "I feel better" — temp 98.6°F\n• No allergies';
      const result = buildDocumentReference({
        ...defaultParams,
        clinicalNoteContent: noteWithSpecialChars,
      });
      const decoded = Buffer.from(result.content[0].attachment.data, 'base64').toString('utf-8');
      expect(decoded).toBe(noteWithSpecialChars);
    });

    it('should handle multi-line SOAP note content', () => {
      const soapNote = [
        'Subjective: Patient reports persistent headache for 3 days.',
        'Objective: BP 130/85, HR 72, Temp 98.6F.',
        'Assessment: Tension headache, likely stress-related.',
        'Plan: Recommend OTC analgesics, stress management, follow-up in 2 weeks.',
      ].join('\n');
      const result = buildDocumentReference({
        ...defaultParams,
        clinicalNoteContent: soapNote,
      });
      const decoded = Buffer.from(result.content[0].attachment.data, 'base64').toString('utf-8');
      expect(decoded).toBe(soapNote);
    });
  });

  describe('type conformance', () => {
    it('should produce a valid DocumentReferenceCreate structure', () => {
      const result: DocumentReferenceCreate = buildDocumentReference(defaultParams);

      // Verify all required fields are present
      expect(result).toHaveProperty('resourceType');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('type.coding');
      expect(result).toHaveProperty('subject');
      expect(result).toHaveProperty('subject.reference');
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('content');
      expect(result.content[0]).toHaveProperty('attachment');
      expect(result.content[0].attachment).toHaveProperty('contentType');
      expect(result.content[0].attachment).toHaveProperty('data');
    });
  });
});
