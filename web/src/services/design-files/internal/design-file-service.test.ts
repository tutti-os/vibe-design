import { describe, expect, it, vi } from 'vitest';
import { DesignFileService } from './design-file-service';

describe('DesignFileService', () => {
  it('delegates listFiles and uploadFiles through the API contract', async () => {
    const files = [new File(['hero'], 'Hero.tsx', { type: 'text/tsx' })];
    const api = {
      listFiles: vi.fn(async () => [
        {
          id: 'file-1',
          path: 'src/Hero.tsx',
          name: 'Hero.tsx',
          type: 'file' as const,
          size: 0,
          mtime: 0,
          kind: 'code' as const,
          mime: 'text/tsx',
        },
      ]),
      readFileContent: vi.fn(async () => 'hero'),
      fileUrl: vi.fn((name: string) => `/api/projects/demo-project/files/${encodeURIComponent(name)}`),
      uploadFiles: vi.fn(async () => [{ path: 'src/Hero.tsx', name: 'Hero.tsx', kind: 'file' as const }]),
      saveFileContent: vi.fn(async (name: string, content: string) => ({
        id: name,
        path: name,
        name,
        type: 'file' as const,
        size: content.length,
        mtime: 0,
        kind: 'code' as const,
        mime: 'text/plain',
      })),
    };
    const service = new DesignFileService(api);

    await expect(service.listFiles()).resolves.toEqual([
      {
        id: 'file-1',
        path: 'src/Hero.tsx',
        name: 'Hero.tsx',
        type: 'file',
        size: 0,
        mtime: 0,
        kind: 'code',
        mime: 'text/tsx',
      },
    ]);
    await expect(service.uploadFiles(files)).resolves.toEqual([
      { path: 'src/Hero.tsx', name: 'Hero.tsx', kind: 'file' },
    ]);
    await expect(service.readFileContent('Hero.tsx')).resolves.toBe('hero');
    expect(service.fileUrl('Hero.tsx')).toBe('/api/projects/demo-project/files/Hero.tsx');
    await expect(service.saveFileContent('Hero.tsx', 'hero')).resolves.toMatchObject({
      name: 'Hero.tsx',
      size: 4,
    });

    expect(api.listFiles).toHaveBeenCalledWith();
    expect(api.readFileContent).toHaveBeenCalledWith('Hero.tsx');
    expect(api.fileUrl).toHaveBeenCalledWith('Hero.tsx');
    expect(api.uploadFiles).toHaveBeenCalledWith(files);
    expect(api.saveFileContent).toHaveBeenCalledWith('Hero.tsx', 'hero');
  });

  it('notifies subscribers when file content is saved', async () => {
    const api = {
      listFiles: vi.fn(async () => []),
      readFileContent: vi.fn(async () => ''),
      fileUrl: vi.fn(() => null),
      uploadFiles: vi.fn(async () => []),
      saveFileContent: vi.fn(async (name: string, content: string) => ({
        id: name,
        path: name,
        name,
        type: 'file' as const,
        size: content.length,
        mtime: 0,
        kind: 'code' as const,
        mime: 'text/html',
      })),
    };
    const service = new DesignFileService(api);
    const listener = vi.fn();

    const unsubscribe = service.subscribe(listener);
    await service.saveFileContent('landing.html', '<!doctype html>');

    expect(listener).toHaveBeenCalledWith({
      type: 'saved',
      file: expect.objectContaining({ path: 'landing.html', name: 'landing.html' }),
      content: '<!doctype html>',
    });

    unsubscribe();
    await service.saveFileContent('second.html', '<!doctype html>');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers after files are uploaded', async () => {
    const uploadedAttachments = [
      { path: 'assets/reference.png', name: 'reference.png', kind: 'image' as const, size: 9, mimeType: 'image/png' },
    ];
    const api = {
      listFiles: vi.fn(async () => []),
      readFileContent: vi.fn(async () => ''),
      fileUrl: vi.fn(() => null),
      uploadFiles: vi.fn(async () => uploadedAttachments),
      saveFileContent: vi.fn(async (name: string, content: string) => ({
        id: name,
        path: name,
        name,
        type: 'file' as const,
        size: content.length,
        mtime: 0,
        kind: 'code' as const,
        mime: 'text/plain',
      })),
    };
    const service = new DesignFileService(api);
    const listener = vi.fn();
    const files = [new File(['reference'], 'reference.png', { type: 'image/png' })];

    service.subscribe(listener);
    await expect(service.uploadFiles(files)).resolves.toEqual(uploadedAttachments);

    expect(listener).toHaveBeenCalledWith({
      type: 'uploaded',
      attachments: uploadedAttachments,
    });
  });
});
