// Feature: ambient-clinical-documentation-demo, Property 6: Session lifecycle state machine
import * as fc from 'fast-check';
import {
  SESSION_LIFECYCLE_ORDER,
  isValidTransition,
  transitionSession,
  isBackwardTransition,
  getLifecycleIndex,
  SessionStatus,
} from './session-manager';

/**
 * Property 6: Session lifecycle state machine
 *
 * For any valid sequence of session lifecycle events (domain setup → subscription setup →
 * session creation → active → ended), the displayed lifecycle stage SHALL match the current
 * state and transitions SHALL only move forward through the defined stages.
 *
 * **Validates: Requirements 4.6**
 */
describe('Property 6: Session lifecycle state machine', () => {
  /** All possible session statuses */
  const allStatuses: SessionStatus[] = [
    'creating_domain',
    'creating_subscription',
    'creating_session',
    'active',
    'ending',
    'ended',
    'error',
  ];

  /** Arbitrary that generates any valid session status */
  const statusArb = fc.constantFrom(...allStatuses);

  /** Arbitrary that generates only lifecycle statuses (not error) */
  const lifecycleStatusArb = fc.constantFrom(...SESSION_LIFECYCLE_ORDER);

  it('valid forward transitions always succeed', () => {
    // For any consecutive pair in the lifecycle order, the transition should succeed
    const consecutivePairArb = fc.integer({ min: 0, max: SESSION_LIFECYCLE_ORDER.length - 2 }).map(
      (i) => [SESSION_LIFECYCLE_ORDER[i], SESSION_LIFECYCLE_ORDER[i + 1]] as [SessionStatus, SessionStatus]
    );

    fc.assert(
      fc.property(consecutivePairArb, ([from, to]) => {
        // The transition should be valid
        const isValid = isValidTransition(from, to);
        if (!isValid) return false;

        // transitionSession should return the new status without throwing
        const result = transitionSession(from, to);
        return result === to;
      }),
      { numRuns: 100 }
    );
  });

  it('backward transitions are always rejected', () => {
    // Generate pairs where toIndex < fromIndex (backward)
    const backwardPairArb = fc
      .tuple(
        fc.integer({ min: 1, max: SESSION_LIFECYCLE_ORDER.length - 1 }),
        fc.integer({ min: 0, max: SESSION_LIFECYCLE_ORDER.length - 2 })
      )
      .filter(([fromIdx, toIdx]) => toIdx < fromIdx)
      .map(([fromIdx, toIdx]) => [SESSION_LIFECYCLE_ORDER[fromIdx], SESSION_LIFECYCLE_ORDER[toIdx]] as [SessionStatus, SessionStatus]);

    fc.assert(
      fc.property(backwardPairArb, ([from, to]) => {
        // Backward transitions should not be valid
        const isValid = isValidTransition(from, to);
        if (isValid) return false;

        // transitionSession should throw for backward transitions
        try {
          transitionSession(from, to);
          return false; // Should have thrown
        } catch {
          return true;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('any non-terminal state can transition to error', () => {
    // All lifecycle statuses (except 'error' itself) can transition to 'error'
    const nonErrorStatusArb = fc.constantFrom(
      ...allStatuses.filter((s) => s !== 'error')
    );

    fc.assert(
      fc.property(nonErrorStatusArb, (status) => {
        const isValid = isValidTransition(status, 'error');
        if (!isValid) return false;

        const result = transitionSession(status, 'error');
        return result === 'error';
      }),
      { numRuns: 100 }
    );
  });

  it('the state machine only allows defined forward transitions (no skipping stages)', () => {
    // For any two non-adjacent lifecycle statuses where toIndex > fromIndex + 1,
    // the transition should be rejected (no skipping)
    const skippingPairArb = fc
      .tuple(
        fc.integer({ min: 0, max: SESSION_LIFECYCLE_ORDER.length - 3 }),
        fc.integer({ min: 2, max: SESSION_LIFECYCLE_ORDER.length - 1 })
      )
      .filter(([fromIdx, toIdx]) => toIdx > fromIdx + 1)
      .map(([fromIdx, toIdx]) => [SESSION_LIFECYCLE_ORDER[fromIdx], SESSION_LIFECYCLE_ORDER[toIdx]] as [SessionStatus, SessionStatus]);

    fc.assert(
      fc.property(skippingPairArb, ([from, to]) => {
        // Skipping stages should not be valid
        const isValid = isValidTransition(from, to);
        if (isValid) return false;

        // transitionSession should throw
        try {
          transitionSession(from, to);
          return false; // Should have thrown
        } catch {
          return true;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('lifecycle indices are strictly increasing through the defined order', () => {
    // For any two lifecycle statuses, if one comes after the other in the order,
    // its index should be strictly greater
    const orderedPairArb = fc
      .tuple(
        fc.integer({ min: 0, max: SESSION_LIFECYCLE_ORDER.length - 2 }),
        fc.integer({ min: 1, max: SESSION_LIFECYCLE_ORDER.length - 1 })
      )
      .filter(([i, j]) => i < j);

    fc.assert(
      fc.property(orderedPairArb, ([i, j]) => {
        const statusA = SESSION_LIFECYCLE_ORDER[i];
        const statusB = SESSION_LIFECYCLE_ORDER[j];
        return getLifecycleIndex(statusA) < getLifecycleIndex(statusB);
      }),
      { numRuns: 100 }
    );
  });

  it('a complete forward traversal through all lifecycle stages succeeds', () => {
    // Generate a random starting index and walk forward from there
    const startIndexArb = fc.integer({ min: 0, max: SESSION_LIFECYCLE_ORDER.length - 2 });

    fc.assert(
      fc.property(startIndexArb, (startIdx) => {
        let currentStatus = SESSION_LIFECYCLE_ORDER[startIdx];

        // Walk forward through remaining stages
        for (let i = startIdx + 1; i < SESSION_LIFECYCLE_ORDER.length; i++) {
          const nextStatus = SESSION_LIFECYCLE_ORDER[i];
          if (!isValidTransition(currentStatus, nextStatus)) {
            return false;
          }
          currentStatus = transitionSession(currentStatus, nextStatus);
          if (currentStatus !== nextStatus) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('error is a terminal state with no outbound transitions', () => {
    fc.assert(
      fc.property(statusArb, (targetStatus) => {
        // No transition from 'error' to any status should be valid
        const isValid = isValidTransition('error', targetStatus);
        return isValid === false;
      }),
      { numRuns: 100 }
    );
  });

  it('self-transitions are never valid', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        return isValidTransition(status, status) === false;
      }),
      { numRuns: 100 }
    );
  });
});
