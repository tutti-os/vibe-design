const projectOperations = new Map<string, Promise<unknown>>();

/**
 * Serialize filesystem mutations for a project while allowing different
 * projects to make progress independently. A failed operation does not poison
 * operations that were already queued behind it.
 */
export function enqueueProjectFileOperation<T>(
  projectsDir: string,
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${projectsDir}\0${projectId}`;
  const previous = projectOperations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tracked = current.finally(() => {
    if (projectOperations.get(key) === tracked) {
      projectOperations.delete(key);
    }
  });
  projectOperations.set(key, tracked);
  return tracked;
}
