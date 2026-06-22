import { afterEach, describe, expect, it } from 'vitest';
import { getManagedAgentInvocationCredential } from './managed-agent-credential';

describe('getManagedAgentInvocationCredential', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('returns null when no TSH bridge is available', async () => {
    await expect(getManagedAgentInvocationCredential()).resolves.toBeNull();
  });

  it('reads the credential from window.tutti', async () => {
    (globalThis as { window?: unknown }).window = {
      tutti: {
        agent: {
          getManagedAgentInvocationCredential: async () => ({ credential: 'credential-run-1' }),
        },
      },
    };

    await expect(getManagedAgentInvocationCredential()).resolves.toBe('credential-run-1');
  });

  it('falls back to window.__tsh', async () => {
    (globalThis as { window?: unknown }).window = {
      __tsh: {
        agent: {
          getManagedAgentInvocationCredential: () => ({ credential: 'credential-run-2' }),
        },
      },
    };

    await expect(getManagedAgentInvocationCredential()).resolves.toBe('credential-run-2');
  });

  it('falls back to window.__tsh when window.tutti has no credential method', async () => {
    (globalThis as { window?: unknown }).window = {
      tutti: {},
      __tsh: {
        agent: {
          getManagedAgentInvocationCredential: () => ({ credential: 'credential-run-3' }),
        },
      },
    };

    await expect(getManagedAgentInvocationCredential()).resolves.toBe('credential-run-3');
  });

  it('does not surface bridge failures', async () => {
    (globalThis as { window?: unknown }).window = {
      tutti: {
        agent: {
          getManagedAgentInvocationCredential: async () => {
            throw new Error('bridge unavailable');
          },
        },
      },
    };

    await expect(getManagedAgentInvocationCredential()).resolves.toBeNull();
  });
});
