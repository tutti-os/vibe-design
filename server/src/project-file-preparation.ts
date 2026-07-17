import { materializeProjectArtifactsFromEvents, waitForProjectArtifactMaterialization } from './artifact-materializer.js';
import { reconcileProjectFilesFromDisk } from './project-file-reconciler.js';

const diskPreparation = new Map<string, Promise<void>>();
const historyPreparation = new Map<string, Promise<void>>();

export function prepareProjectFilesFromDisk(projectsDir: string, projectId: string): Promise<void> {
  const key = `${projectsDir}\0${projectId}`;
  const existing = diskPreparation.get(key);
  const liveMaterialization = waitForProjectArtifactMaterialization(projectsDir, projectId);
  if (existing) return liveMaterialization.then(() => existing);
  const preparation = liveMaterialization
    .then(() => reconcileProjectFilesFromDisk(projectsDir, projectId));
  diskPreparation.set(key, preparation);
  return preparation.finally(() => {
    if (diskPreparation.get(key) === preparation) diskPreparation.delete(key);
  });
}

export function prepareProjectFilesWithHistory(
  projectsDir: string,
  projectId: string,
  eventBatches: readonly unknown[][],
): Promise<void> {
  const key = `${projectsDir}\0${projectId}`;
  const existing = historyPreparation.get(key);
  const liveMaterialization = waitForProjectArtifactMaterialization(projectsDir, projectId);
  let historyBackfill = existing;
  if (!historyBackfill) {
    const preparation = liveMaterialization.then(async () => {
      for (const events of eventBatches) {
        await materializeProjectArtifactsFromEvents(projectsDir, projectId, events);
      }
    });
    let trackedPreparation: Promise<void>;
    trackedPreparation = preparation.finally(() => {
      if (historyPreparation.get(key) === trackedPreparation) {
        historyPreparation.delete(key);
      }
    });
    historyBackfill = trackedPreparation;
    historyPreparation.set(key, trackedPreparation);
  }
  return historyBackfill.then(() => prepareProjectFilesFromDisk(projectsDir, projectId));
}
