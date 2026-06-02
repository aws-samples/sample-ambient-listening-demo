/**
 * Request validation for the encounter writeback API endpoint.
 *
 * Validates that the request body contains all required fields:
 * - patientId: must be present and non-empty
 * - sections: must contain at least one section with non-empty content
 */

export interface CreateEncounterRequest {
  patientId: string;
  sections: {
    heading: string;
    content: string;
  }[];
  sessionId?: string;
}

export interface ValidationError {
  valid: false;
  error: string;
}

export interface ValidationSuccess {
  valid: true;
}

export type ValidationResult = ValidationError | ValidationSuccess;

/**
 * Validates a create encounter request body.
 *
 * Returns a ValidationError if:
 * - patientId is missing, null, undefined, or empty/whitespace-only
 * - sections is missing, not an array, or contains zero non-empty sections
 *
 * A section is considered "non-empty" if its content field is a non-empty
 * string after trimming.
 */
export function validateCreateEncounterRequest(body: unknown): ValidationResult {
  if (body === null || body === undefined || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const request = body as Record<string, unknown>;

  // Validate patientId
  if (
    !request.patientId ||
    typeof request.patientId !== 'string' ||
    request.patientId.trim().length === 0
  ) {
    return { valid: false, error: 'patientId is required and must be a non-empty string' };
  }

  // Validate sections
  if (!request.sections || !Array.isArray(request.sections)) {
    return { valid: false, error: 'sections is required and must be an array' };
  }

  const nonEmptySections = request.sections.filter(
    (section: unknown) =>
      section !== null &&
      typeof section === 'object' &&
      typeof (section as Record<string, unknown>).content === 'string' &&
      ((section as Record<string, unknown>).content as string).trim().length > 0
  );

  if (nonEmptySections.length === 0) {
    return { valid: false, error: 'At least one section with non-empty content is required' };
  }

  return { valid: true };
}
