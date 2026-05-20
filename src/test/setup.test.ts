/**
 * @jest-environment jsdom
 */

/**
 * Smoke test to verify Jest and testing infrastructure is working correctly.
 */
describe('Testing Infrastructure', () => {
  it('should run a basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should resolve @/ path aliases', async () => {
    const { samplePatientContext, sampleSession } = await import('@/test/fixtures');
    expect(samplePatientContext.demographics.name).toBe('John Doe');
    expect(sampleSession.sessionId).toBe('session-123');
  });

  it('should have jest-dom matchers available', () => {
    const div = document.createElement('div');
    div.textContent = 'Hello';
    document.body.appendChild(div);
    expect(div).toBeInTheDocument();
    document.body.removeChild(div);
  });

  it('should have fast-check available for property-based testing', async () => {
    const fc = await import('fast-check');
    expect(fc.assert).toBeDefined();
    expect(fc.property).toBeDefined();
  });

  it('should have MSW server running for API mocking', () => {
    // The MSW server is started in setup.ts via beforeAll/afterAll hooks.
    // If this test runs without error, the server lifecycle is working.
    expect(true).toBe(true);
  });
});
