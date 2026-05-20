/**
 * Combined MSW request handlers for all mocked services.
 * Import this file to get all handlers for FHIR API and S3 mocking.
 */
export { fhirHandlers } from './fhir-handlers';
export { s3Handlers } from './s3-handlers';

import { fhirHandlers } from './fhir-handlers';
import { s3Handlers } from './s3-handlers';

/** All handlers combined for use with MSW setupServer. */
export const allHandlers = [...fhirHandlers, ...s3Handlers];
