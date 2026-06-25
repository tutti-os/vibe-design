import React from 'react';

interface SubscribableSnapshotService<TSnapshot> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TSnapshot;
}

// Subscribes a component to a service's snapshot, re-rendering whenever the
// service notifies its listeners.
export function useServiceSnapshot<TSnapshot>(
  service: SubscribableSnapshotService<TSnapshot>,
): TSnapshot {
  const versionRef = React.useRef(0);
  const subscribe = React.useCallback(
    (listener: () => void) =>
      service.subscribe(() => {
        versionRef.current += 1;
        listener();
      }),
    [service],
  );
  const getVersion = React.useCallback(() => versionRef.current, []);
  const version = React.useSyncExternalStore(subscribe, getVersion, getVersion);

  return React.useMemo(() => service.getSnapshot(), [service, version]);
}
