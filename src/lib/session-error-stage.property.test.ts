// Feature: ambient-clinical-documentation-demo, Property 5: Session lifecycle error stage identification
import * as fc from 'fast-check';
import {
  createSessionError,
  identifyErrorStage,
  getSuggestedAction,
  SessionStatus,
  ErrorStage,
} from './session-manager';

/**
 * Property 5: Session lifecycle error stage identification
 *
 * For any failure occurring during domain creation, subscription creation, or session creation,
 * the error display SHALL correctly identify the failure stage and include a non-empty
 * corrective action suggestion.
 *
 * **Validates: Requirements 4.5**
 */
describe('Property 5: Session lifecycle error stage identification', () => {
  /**
   * The three creation stages that are the focus of this property per Requirements 4.5:
   * domain creation, subscription creation, and session creation.
   */
  const creationStatuses: SessionStatus[] = [
    'creating_domain',
    'creating_subscription',
    'creating_session',
  ];

  /** Expected error stage mapping for creation statuses */
  const expectedStageMapping: Record<string, ErrorStage> = {
    creating_domain: 'domain',
    creating_subscription: 'subscription',
    creating_session: 'session',
  };

  /** Arbitrary that generates one of the three creation lifecycle statuses */
  const creationStatusArb = fc.constantFrom(...creationStatuses);

  /** Arbitrary that generates a non-empty error message string */
  const errorMessageArb = fc.string({ minLength: 1, maxLength: 500 });

  it('correctly identifies the failure stage for domain, subscription, and session creation failures', () => {
    fc.assert(
      fc.property(creationStatusArb, errorMessageArb, (status, message) => {
        const error = createSessionError(status, message);
        const expectedStage = expectedStageMapping[status];

        // The error stage must match the expected mapping
        return error.stage === expectedStage;
      }),
      { numRuns: 100 }
    );
  });

  it('always includes a non-empty corrective action suggestion for creation failures', () => {
    fc.assert(
      fc.property(creationStatusArb, errorMessageArb, (status, message) => {
        const error = createSessionError(status, message);

        // suggestedAction must be a non-empty string
        return (
          typeof error.suggestedAction === 'string' &&
          error.suggestedAction.length > 0
        );
      }),
      { numRuns: 100 }
    );
  });

  it('preserves the original error message in the SessionError', () => {
    fc.assert(
      fc.property(creationStatusArb, errorMessageArb, (status, message) => {
        const error = createSessionError(status, message);

        // The error message should be preserved exactly
        return error.message === message;
      }),
      { numRuns: 100 }
    );
  });

  it('identifyErrorStage returns the correct stage for all creation statuses', () => {
    fc.assert(
      fc.property(creationStatusArb, (status) => {
        const stage = identifyErrorStage(status);
        return stage === expectedStageMapping[status];
      }),
      { numRuns: 100 }
    );
  });

  it('getSuggestedAction returns a non-empty string for all error stages from creation failures', () => {
    const creationErrorStages: ErrorStage[] = ['domain', 'subscription', 'session'];
    const creationErrorStageArb = fc.constantFrom(...creationErrorStages);

    fc.assert(
      fc.property(creationErrorStageArb, (stage) => {
        const action = getSuggestedAction(stage);
        return typeof action === 'string' && action.length > 0;
      }),
      { numRuns: 100 }
    );
  });

  it('each creation stage maps to a distinct error stage', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...creationStatuses),
        fc.constantFrom(...creationStatuses),
        (statusA, statusB) => {
          if (statusA === statusB) return true; // Same input, same output is fine

          const stageA = identifyErrorStage(statusA);
          const stageB = identifyErrorStage(statusB);

          // Different creation statuses must map to different error stages
          return stageA !== stageB;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the SessionError structure has all required fields for any creation failure', () => {
    fc.assert(
      fc.property(creationStatusArb, errorMessageArb, (status, message) => {
        const error = createSessionError(status, message);

        // Verify the error has all required fields from the SessionError interface
        return (
          'stage' in error &&
          'message' in error &&
          'suggestedAction' in error &&
          typeof error.stage === 'string' &&
          typeof error.message === 'string' &&
          typeof error.suggestedAction === 'string'
        );
      }),
      { numRuns: 100 }
    );
  });
});
