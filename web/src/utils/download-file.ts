/**
 * Download a file by actually fetching its bytes before saving it locally.
 *
 * The naive `<a download>` approach fires immediately on click, so any "downloaded"
 * toast shows up before the file truly lands — especially inside the app shell
 * (webview), where the host handles the transfer asynchronously. Fetching the blob
 * ourselves means the returned promise only resolves once the bytes are in hand, so
 * callers can show their success toast at the moment the download is genuinely done.
 */
export async function downloadFileFromUrl(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download "${filename}" (status ${response.status})`);
  }

  const blob = await response.blob();
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
