interface ManagedAgentCredentialBridge {
  agent?: {
    getManagedAgentInvocationCredential?: () =>
      | { credential?: unknown }
      | Promise<{ credential?: unknown }>;
  };
}

declare global {
  interface Window {
    tutti?: ManagedAgentCredentialBridge;
    __tsh?: ManagedAgentCredentialBridge;
  }
}

export async function getManagedAgentInvocationCredential(): Promise<string | null> {
  const bridge = getManagedAgentCredentialBridge();
  const getCredential = bridge?.agent?.getManagedAgentInvocationCredential;
  if (typeof getCredential !== 'function') {
    return null;
  }

  const result = await Promise.resolve(getCredential()).catch(() => null);
  const credential = result?.credential;
  return typeof credential === 'string' && credential.trim() ? credential : null;
}

function getManagedAgentCredentialBridge(): ManagedAgentCredentialBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.tutti ?? window.__tsh ?? null;
}
