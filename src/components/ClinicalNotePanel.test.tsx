/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClinicalNotePanel } from './ClinicalNotePanel';
import { ClinicalNote, EvidenceMapping, SOAPSection } from '../types';

function createSOAPSections(overrides: Partial<SOAPSection>[] = []): SOAPSection[] {
  const defaults: SOAPSection[] = [
    {
      heading: 'Subjective',
      content: 'Patient reports persistent headache for 3 days. Pain is throbbing and located in the frontal region.',
    },
    {
      heading: 'Objective',
      content: 'Vital signs stable. BP 120/80. Temperature 98.6F. No focal neurological deficits.',
    },
    {
      heading: 'Assessment',
      content: 'Tension-type headache, likely stress-related. No red flags for secondary causes.',
    },
    {
      heading: 'Plan',
      content: 'Recommend OTC analgesics. Follow up in 2 weeks if symptoms persist. Consider imaging if worsening.',
    },
  ];

  return defaults.map((section, i) => ({
    ...section,
    ...(overrides[i] || {}),
  }));
}

function createEvidenceMapping(overrides: Partial<EvidenceMapping> = {}): EvidenceMapping {
  return {
    noteStatementId: 'ev-1',
    noteStatement: 'Patient reports persistent headache for 3 days',
    sourceType: 'transcript',
    transcriptReference: {
      startTime: 12.5,
      endTime: 18.3,
      content: 'I have had this headache for about three days now.',
    },
    ...overrides,
  };
}

function createClinicalNote(overrides: Partial<ClinicalNote> = {}): ClinicalNote {
  return {
    sections: createSOAPSections(),
    evidenceMap: [
      createEvidenceMapping(),
      createEvidenceMapping({
        noteStatementId: 'ev-2',
        noteStatement: 'Vital signs stable',
        sourceType: 'transcript',
        transcriptReference: {
          startTime: 45.0,
          endTime: 52.0,
          content: 'Your vitals look good today.',
        },
      }),
      createEvidenceMapping({
        noteStatementId: 'ev-3',
        noteStatement: 'Known allergy to penicillin',
        sourceType: 'patient_context',
        transcriptReference: undefined,
      }),
    ],
    ...overrides,
  };
}

describe('ClinicalNotePanel', () => {
  describe('loading state', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(<ClinicalNotePanel clinicalNote={null} isLoading={true} />);

      expect(screen.getByRole('status', { name: /loading clinical note/i })).toBeInTheDocument();
      expect(screen.getByText(/generating clinical note/i)).toBeInTheDocument();
    });

    it('shows empty state when clinicalNote is null and not loading', () => {
      render(<ClinicalNotePanel clinicalNote={null} isLoading={false} />);

      expect(screen.getByText(/no clinical note available/i)).toBeInTheDocument();
    });

    it('shows loading state when clinicalNote is null without isLoading prop', () => {
      render(<ClinicalNotePanel clinicalNote={null} />);

      expect(screen.getByText(/no clinical note available/i)).toBeInTheDocument();
    });
  });

  describe('SOAP section display', () => {
    it('renders all four SOAP section headings', () => {
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} />);

      expect(screen.getByText('Subjective')).toBeInTheDocument();
      expect(screen.getByText('Objective')).toBeInTheDocument();
      expect(screen.getByText('Assessment')).toBeInTheDocument();
      expect(screen.getByText('Plan')).toBeInTheDocument();
    });

    it('renders section content for each SOAP section', () => {
      const note = createClinicalNote();
      const { container } = render(<ClinicalNotePanel clinicalNote={note} />);

      // Use the section containers to verify content is rendered within each section
      const subjective = container.querySelector('[data-testid="soap-section-subjective"] p');
      expect(subjective).toHaveTextContent(/patient reports persistent headache/i);

      const objective = container.querySelector('[data-testid="soap-section-objective"] p');
      expect(objective).toHaveTextContent(/vital signs stable/i);

      const assessment = container.querySelector('[data-testid="soap-section-assessment"] p');
      expect(assessment).toHaveTextContent(/tension-type headache/i);

      const plan = container.querySelector('[data-testid="soap-section-plan"] p');
      expect(plan).toHaveTextContent(/recommend otc analgesics/i);
    });

    it('renders sections with data-testid attributes', () => {
      const note = createClinicalNote();
      const { container } = render(<ClinicalNotePanel clinicalNote={note} />);

      expect(container.querySelector('[data-testid="soap-section-subjective"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="soap-section-objective"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="soap-section-assessment"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="soap-section-plan"]')).toBeInTheDocument();
    });

    it('renders with region role and accessible label', () => {
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} />);

      expect(screen.getByRole('region', { name: /clinical note/i })).toBeInTheDocument();
    });
  });

  describe('evidence map rendering', () => {
    it('renders evidence entries as clickable links for transcript sources', () => {
      const note = createClinicalNote();
      const handleClick = jest.fn();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={handleClick} />);

      const evidenceLink = screen.getByTestId('evidence-link-ev-1');
      expect(evidenceLink).toBeInTheDocument();
      expect(evidenceLink.tagName).toBe('BUTTON');
    });

    it('renders evidence entries as non-clickable for patient_context sources', () => {
      const note = createClinicalNote();
      const handleClick = jest.fn();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={handleClick} />);

      const evidenceLink = screen.getByTestId('evidence-link-ev-3');
      expect(evidenceLink).toBeInTheDocument();
      expect(evidenceLink.tagName).toBe('DIV');
    });

    it('displays time range for transcript evidence entries', () => {
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={jest.fn()} />);

      // 12.5s = 0:12, 18.3s = 0:18
      expect(screen.getByText(/0:12 – 0:18/)).toBeInTheDocument();
    });

    it('displays source type label for evidence entries', () => {
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={jest.fn()} />);

      const transcriptLabels = screen.getAllByText('Transcript');
      expect(transcriptLabels.length).toBeGreaterThan(0);

      expect(screen.getByText('Patient Context')).toBeInTheDocument();
    });

    it('renders all evidence entries', () => {
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={jest.fn()} />);

      expect(screen.getByTestId('evidence-link-ev-1')).toBeInTheDocument();
      expect(screen.getByTestId('evidence-link-ev-2')).toBeInTheDocument();
      expect(screen.getByTestId('evidence-link-ev-3')).toBeInTheDocument();
    });
  });

  describe('evidence click interaction', () => {
    it('calls onEvidenceClick when a transcript evidence link is clicked', () => {
      const handleClick = jest.fn();
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={handleClick} />);

      fireEvent.click(screen.getByTestId('evidence-link-ev-1'));

      expect(handleClick).toHaveBeenCalledTimes(1);
      expect(handleClick).toHaveBeenCalledWith(note.evidenceMap[0]);
    });

    it('calls onEvidenceClick with correct evidence entry for different entries', () => {
      const handleClick = jest.fn();
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={handleClick} />);

      fireEvent.click(screen.getByTestId('evidence-link-ev-2'));

      expect(handleClick).toHaveBeenCalledWith(note.evidenceMap[1]);
    });

    it('does not render clickable buttons when onEvidenceClick is not provided', () => {
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} />);

      // All evidence entries should be divs, not buttons
      const ev1 = screen.getByTestId('evidence-link-ev-1');
      expect(ev1.tagName).toBe('DIV');
    });

    it('does not call onEvidenceClick for patient_context evidence', () => {
      const handleClick = jest.fn();
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={handleClick} />);

      // patient_context evidence (ev-3) should not be a button
      const ev3 = screen.getByTestId('evidence-link-ev-3');
      fireEvent.click(ev3);

      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('evidence grouping by section', () => {
    it('groups evidence entries under their matching SOAP section', () => {
      const note = createClinicalNote();
      const { container } = render(
        <ClinicalNotePanel clinicalNote={note} onEvidenceClick={jest.fn()} />
      );

      // ev-1 matches Subjective section content
      const subjectiveSection = container.querySelector('[data-testid="soap-section-subjective"]');
      expect(subjectiveSection?.querySelector('[data-testid="evidence-link-ev-1"]')).toBeInTheDocument();

      // ev-2 matches Objective section content
      const objectiveSection = container.querySelector('[data-testid="soap-section-objective"]');
      expect(objectiveSection?.querySelector('[data-testid="evidence-link-ev-2"]')).toBeInTheDocument();
    });

    it('renders unmatched evidence entries in a separate section', () => {
      const note = createClinicalNote();
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={jest.fn()} />);

      // ev-3 "Known allergy to penicillin" doesn't match any section content
      expect(screen.getByText('Evidence References')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('handles clinical note with empty evidence map', () => {
      const note = createClinicalNote({ evidenceMap: [] });
      render(<ClinicalNotePanel clinicalNote={note} />);

      expect(screen.getByText('Subjective')).toBeInTheDocument();
      expect(screen.getByText('Objective')).toBeInTheDocument();
      expect(screen.getByText('Assessment')).toBeInTheDocument();
      expect(screen.getByText('Plan')).toBeInTheDocument();
    });

    it('handles clinical note with empty section content', () => {
      const note = createClinicalNote({
        sections: [
          { heading: 'Subjective', content: '' },
          { heading: 'Objective', content: '' },
          { heading: 'Assessment', content: '' },
          { heading: 'Plan', content: '' },
        ],
        evidenceMap: [],
      });
      render(<ClinicalNotePanel clinicalNote={note} />);

      expect(screen.getByText('Subjective')).toBeInTheDocument();
      expect(screen.getByText('Plan')).toBeInTheDocument();
    });

    it('handles evidence with no transcript reference', () => {
      const note = createClinicalNote({
        evidenceMap: [
          createEvidenceMapping({
            noteStatementId: 'ev-no-ref',
            noteStatement: 'Some statement',
            sourceType: 'transcript',
            transcriptReference: undefined,
          }),
        ],
      });
      render(<ClinicalNotePanel clinicalNote={note} onEvidenceClick={jest.fn()} />);

      // Should render as non-clickable since no transcript reference
      const link = screen.getByTestId('evidence-link-ev-no-ref');
      expect(link.tagName).toBe('DIV');
    });
  });
});
