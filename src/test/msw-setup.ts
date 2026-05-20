/**
 * MSW server setup for integration tests.
 * Import this file in test files that need API mocking.
 *
 * Note: MSW v2 requires Node.js fetch globals which are available
 * in the custom jest-environment-node-with-fetch environment.
 * Tests using MSW should use:
 *   @jest-environment ./src/test/jest-environment-node-with-fetch.js
 */
import { server } from './mocks/server';

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));

// Reset handlers between tests
afterEach(() => server.resetHandlers());

// Clean up after all tests
afterAll(() => server.close());

export { server };
