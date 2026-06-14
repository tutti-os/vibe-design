import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchDesignFileApi } from './design-file-api';

describe('FetchDesignFileApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads files to the project file endpoint and normalizes attachments', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(
        JSON.stringify({
          file: { path: 'Hero.tsx', name: 'Hero.tsx', kind: 'code', size: 12, mime: 'text/tsx' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const file = new File(['hero'], 'Hero.tsx', { type: 'text/tsx' });
    const api = new FetchDesignFileApi('demo-project');

    await expect(api.uploadFiles([file])).resolves.toEqual([
      { path: 'Hero.tsx', name: 'Hero.tsx', kind: 'file', size: 4, mimeType: 'text/tsx' },
    ]);

    expect(fetch).toHaveBeenCalledWith('/api/projects/demo-project/files', {
      method: 'POST',
      body: expect.any(FormData),
    });
    const requestBody = fetch.mock.calls[0][1]?.body;
    expect(requestBody).toBeInstanceOf(FormData);
    expect((requestBody as FormData).getAll('file')).toEqual([file]);
  });

  it('uploads files to the public asset endpoint when no project is active', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(
        JSON.stringify({
          file: { path: 'assets/reference.png', name: 'reference.png', kind: 'image', size: 9, mime: 'image/png' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const file = new File(['reference'], 'reference.png', { type: 'image/png' });
    const api = new FetchDesignFileApi(null);

    await expect(api.uploadFiles([file])).resolves.toEqual([
      { path: 'assets/reference.png', name: 'reference.png', kind: 'image', size: 9, mimeType: 'image/png' },
    ]);

    expect(fetch).toHaveBeenCalledWith('/api/assets', {
      method: 'POST',
      body: expect.any(FormData),
    });
  });


  it('throws the transport error message when upload fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Upload denied' }), { status: 403 })),
    );
    const api = new FetchDesignFileApi('demo-project');

    await expect(api.uploadFiles([new File(['hero'], 'Hero.tsx')])).rejects.toThrow('Upload denied');
  });

  it('throws the nested API error message when upload fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message: 'file name is invalid',
            },
          },
          { status: 400 },
        ),
      ),
    );
    const api = new FetchDesignFileApi('demo-project');

    await expect(api.uploadFiles([new File(['hero'], 'Hero.tsx')])).rejects.toThrow('file name is invalid');
  });

  it('saves file contents to the project file endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(
        JSON.stringify({
          file: { path: 'Hero.html', name: 'Hero.html', kind: 'html', size: 12, mime: 'text/html' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const api = new FetchDesignFileApi('demo-project');

    await expect(api.saveFileContent('Hero.html', '<main />')).resolves.toMatchObject({
      name: 'Hero.html',
      kind: 'html',
    });

    expect(fetch).toHaveBeenCalledWith('/api/projects/demo-project/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hero.html', content: '<main />', encoding: 'utf8' }),
    });
  });

  it('reads file contents from the project file endpoint and exposes its URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('<main>Hero</main>', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const api = new FetchDesignFileApi('demo-project');

    expect(api.fileUrl('Hero.html')).toBe('/api/projects/demo-project/files/Hero.html');
    await expect(api.readFileContent('Hero.html')).resolves.toBe('<main>Hero</main>');
    expect(fetch).toHaveBeenCalledWith('/api/projects/demo-project/files/Hero.html');
  });

  it('throws when reading file contents without an active project', async () => {
    const api = new FetchDesignFileApi(null);

    expect(api.fileUrl('Hero.html')).toBeNull();
    await expect(api.readFileContent('Hero.html')).rejects.toThrow('Could not read design file.');
  });
});
