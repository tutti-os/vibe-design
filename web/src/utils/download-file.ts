/**
 * Download a file by actually fetching its bytes and waiting for the save to finish.
 *
 * The naive `<a download>` approach fires immediately on click, so any "downloaded"
 * toast shows up before the file truly lands. Even fetching the blob first only tells
 * us the bytes are in hand — the browser still saves asynchronously after the click,
 * so the promise resolves before the user has picked a location or the file has been
 * written.
 *
 * When the File System Access API is available we use `showSaveFilePicker`, whose
 * promise chain only settles once the user has chosen a destination AND the bytes have
 * been flushed to disk — so callers can show their success toast at the exact moment
 * the save is genuinely complete. Browsers without it fall back to the anchor approach.
 *
 * Resolves with `true` when the file was saved, or `false` when the user cancelled the
 * save dialog (so callers can stay silent instead of showing a misleading error).
 * Rejects only on a real failure (network error, write error).
 */
export async function downloadFileFromUrl(url: string, filename: string): Promise<boolean> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download "${filename}" (status ${response.status})`);
  }

  const blob = await response.blob();

  if (supportsFileSystemAccess()) {
    return saveBlobWithPicker(blob, filename);
  }

  saveBlobWithAnchor(blob, filename);
  return true;
}

function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

async function saveBlobWithPicker(blob: Blob, filename: string): Promise<boolean> {
  let handle: FileSystemFileHandle;
  try {
    handle = await window.showSaveFilePicker!({
      suggestedName: filename,
      types: blob.type
        ? [{ accept: { [blob.type]: [] } }]
        : undefined,
    });
  } catch (error) {
    // The user dismissed the save dialog — not a failure, just nothing to do.
    if (isAbortError(error)) {
      return false;
    }
    throw error;
  }

  // These steps only settle once the bytes are actually flushed to disk.
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return true;
}

function saveBlobWithAnchor(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke on the next tick so the click has a chance to start the save.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
