interface ManagedAgentCredentialBridge {
  agent?: {
    getManagedAgentInvocationCredential?: ManagedAgentCredentialGetter;
  };
}

type ManagedAgentCredentialGetter = () =>
  | { credential?: unknown }
  | Promise<{ credential?: unknown }>;

declare global {
  interface Window {
    tutti?: ManagedAgentCredentialBridge;
    __tsh?: ManagedAgentCredentialBridge;
  }
}

export async function getManagedAgentInvocationCredential(): Promise<string | null> {
  const getCredential = getManagedAgentCredentialGetter();
  if (typeof getCredential !== 'function') {
    return null;
  }

  const result = await Promise.resolve(getCredential()).catch(() => null);
  const credential = result?.credential;
  return typeof credential === 'string' && credential.trim() ? credential : null;
}

function getManagedAgentCredentialGetter(): ManagedAgentCredentialGetter | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const bridges = [window.tutti, window.__tsh];
  for (const bridge of bridges) {
    const getCredential = bridge?.agent?.getManagedAgentInvocationCredential;
    if (typeof getCredential === 'function') {
      return getCredential;
    }
  }
  return null;
}
