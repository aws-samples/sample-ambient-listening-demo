import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * MSW server instance for use in Jest tests.
 * Started/stopped in src/test/setup.ts.
 */
export const server = setupServer(...handlers);
