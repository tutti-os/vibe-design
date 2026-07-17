import { materializeProjectArtifactsFromEvents } from './artifact-materializer.js';
import { enqueueProjectFileOperation } from './project-file-coordinator.js';
import { reconcileProjectFilesFromDisk } from './project-file-reconciler.js';
import {
  getArtifactBackfillWatermark,
  getProjectFilePreparationState,
  listNonArtifactManagedProjectFileNames,
  markArtifactBackfillWatermark,
  markProjectCanonicalPreparation,
  markProjectFileScanDirty,
} from './sqlite-store.js';

export interface HistoricalEventBatch {
  id: string;
  events: readonly unknown[];
}

const CANONICAL_ASSETS_VERSION = 1;
const activeProjectRuns = new Map<string, Set<string>>();

/**
 * Ensure the one-time root -> assets compatibility migration has completed.
 * Once the SQLite marker exists this is a database-only fast path: no NFS
 * directory scan is performed by GET /files or editor polling.
 */
export function prepareProjectFilesFromDisk(projectsDir: string, projectId: string): Promise<void> {
  if (hasActiveProjectRuns(projectsDir, projectId)) {
    return Promise.resolve();
  }
  if (isCanonicalPreparationCurrent(projectsDir, projectId) && !isProjectScanDirty(projectsDir, projectId)) {
    return Promise.resolve();
  }
  return enqueueProjectFileOperation(projectsDir, projectId, async () => {
    // A GET must never project a partial provider workspace or clear the
    // durable crash-recovery marker while any run for this project is active.
    if (hasActiveProjectRuns(projectsDir, projectId)) return;
    if (isCanonicalPreparationCurrent(projectsDir, projectId) && !isProjectScanDirty(projectsDir, projectId)) return;
    const scanDirty = isProjectScanDirty(projectsDir, projectId);
    await reconcileProjectFilesFromDisk(projectsDir, projectId, {
      pruneMissing: scanDirty,
      reviveTombstones: scanDirty,
    });
    markProjectCanonicalPreparation(projectsDir, projectId, CANONICAL_ASSETS_VERSION);
    if (hasActiveProjectRuns(projectsDir, projectId)) return;
    markProjectFileScanDirty(projectsDir, projectId, false);
  });
}

/**
 * Backfill completed historical runs at most once per durable event version.
 * Live events already update the canonical file and index directly. After an
 * app restart, only a message whose event count/tail id changed is reparsed.
 */
export function prepareProjectFilesWithHistory(
  projectsDir: string,
  projectId: string,
  eventBatches: readonly HistoricalEventBatch[],
): Promise<void> {
  return enqueueProjectFileOperation(projectsDir, projectId, async () => {
    if (
      !hasActiveProjectRuns(projectsDir, projectId)
      && (!isCanonicalPreparationCurrent(projectsDir, projectId) || isProjectScanDirty(projectsDir, projectId))
    ) {
      const scanDirty = isProjectScanDirty(projectsDir, projectId);
      await reconcileProjectFilesFromDisk(projectsDir, projectId, {
        pruneMissing: scanDirty,
        reviveTombstones: scanDirty,
      });
      markProjectCanonicalPreparation(projectsDir, projectId, CANONICAL_ASSETS_VERSION);
      if (!hasActiveProjectRuns(projectsDir, projectId)) {
        markProjectFileScanDirty(projectsDir, projectId, false);
      }
    }

    let firstChangedBatch = -1;
    const storedWatermarks = eventBatches.map((batch) =>
      getArtifactBackfillWatermark(projectsDir, projectId, batch.id));
    const watermarks = eventBatches.map((batch, index) => {
      const watermark = watermarkForEvents(batch.events);
      const stored = storedWatermarks[index];
      if (
        firstChangedBatch < 0 &&
        (stored?.eventCount !== watermark.eventCount || stored.lastEventId !== watermark.lastEventId)
      ) {
        firstChangedBatch = index;
      }
      return watermark;
    });
    if (firstChangedBatch < 0) return;
    const preserveExistingNames = storedWatermarks[firstChangedBatch]
      ? undefined
      : new Set(listNonArtifactManagedProjectFileNames(projectsDir, projectId));

    // Replay the changed suffix with overwrite semantics. If an older batch
    // and a later batch use the same artifact identifier, the chronological
    // tail replay guarantees the latest durable event wins after a crash.
    for (let index = firstChangedBatch; index < eventBatches.length; index += 1) {
      const batch = eventBatches[index]!;
      const watermark = watermarks[index]!;
      await materializeProjectArtifactsFromEvents(
        projectsDir,
        projectId,
        [...batch.events],
        { overwriteExisting: true, ...(preserveExistingNames ? { preserveExistingNames } : {}) },
      );
      markArtifactBackfillWatermark(projectsDir, projectId, batch.id, watermark);
    }
  });
}

/**
 * One lightweight metadata reconciliation at the end of a run discovers
 * writes made by shell tools that do not emit structured file_write events.
 */
export function scanProjectFilesAfterRun(projectsDir: string, projectId: string, runId: string): Promise<void> {
  return enqueueProjectFileOperation(projectsDir, projectId, async () => {
    removeActiveProjectRun(projectsDir, projectId, runId);
    if (hasActiveProjectRuns(projectsDir, projectId)) return;
    await reconcileProjectFilesFromDisk(projectsDir, projectId, {
      pruneMissing: true,
      reviveTombstones: true,
    });
    markProjectCanonicalPreparation(projectsDir, projectId, CANONICAL_ASSETS_VERSION);
    if (hasActiveProjectRuns(projectsDir, projectId)) return;
    markProjectFileScanDirty(projectsDir, projectId, false);
  });
}

export function markProjectFilesDirty(projectsDir: string, projectId: string, runId: string): void {
  // Persist first. If SQLite is unavailable, the provider must not be added to
  // the volatile fence without a crash-recovery marker.
  markProjectFileScanDirty(projectsDir, projectId, true);
  const key = activeProjectKey(projectsDir, projectId);
  const runs = activeProjectRuns.get(key) ?? new Set<string>();
  runs.add(runId);
  activeProjectRuns.set(key, runs);
}

function removeActiveProjectRun(projectsDir: string, projectId: string, runId: string): void {
  const key = activeProjectKey(projectsDir, projectId);
  const runs = activeProjectRuns.get(key);
  if (!runs) return;
  runs.delete(runId);
  if (runs.size === 0) activeProjectRuns.delete(key);
}

function hasActiveProjectRuns(projectsDir: string, projectId: string): boolean {
  return (activeProjectRuns.get(activeProjectKey(projectsDir, projectId))?.size ?? 0) > 0;
}

function activeProjectKey(projectsDir: string, projectId: string): string {
  return `${projectsDir}\0${projectId}`;
}

function isCanonicalPreparationCurrent(projectsDir: string, projectId: string): boolean {
  return (getProjectFilePreparationState(projectsDir, projectId)?.canonicalVersion ?? 0) >= CANONICAL_ASSETS_VERSION;
}

function isProjectScanDirty(projectsDir: string, projectId: string): boolean {
  return getProjectFilePreparationState(projectsDir, projectId)?.scanDirty ?? false;
}

function watermarkForEvents(events: readonly unknown[]): { eventCount: number; lastEventId: string | null } {
  let lastEventId: string | null = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isRecord(event) && typeof event.eventId === 'number' && Number.isFinite(event.eventId)) {
      lastEventId = String(event.eventId);
      break;
    }
    if (isRecord(event) && typeof event.eventId === 'string' && event.eventId) {
      lastEventId = event.eventId;
      break;
    }
  }
  return { eventCount: events.length, lastEventId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
