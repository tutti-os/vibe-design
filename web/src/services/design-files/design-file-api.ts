import type { ChatAttachment, ProjectFile } from '../../types';
import { readProjectFile } from '../project-file-normalizer';
import type { DesignFileApi } from './design-file-types';

export class FetchDesignFileApi implements DesignFileApi {
  constructor(private readonly projectId: string | null = null) {}

  async listFiles(): Promise<ProjectFile[]> {
    if (!this.projectId) return [];

    const response = await fetch(`/api/projects/${encodeURIComponent(this.projectId)}/files`);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not list design files.'));
    }

    return readProjectFiles(data);
  }

  async saveFileContent(name: string, content: string): Promise<ProjectFile> {
    if (!this.projectId) {
      throw new Error('Could not save design file.');
    }

    const response = await fetch(`/api/projects/${encodeURIComponent(this.projectId)}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content, encoding: 'utf8' }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not save design file.'));
    }

    const file = readUploadedFile(data);
    if (!file) {
      throw new Error('Could not save design file.');
    }

    return file;
  }

  async readFileContent(name: string): Promise<string> {
    const fileUrl = this.fileUrl(name);
    if (!fileUrl) {
      throw new Error('Could not read design file.');
    }

    const response = await fetch(fileUrl);
    const data = response.ok ? null : await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(readErrorMessage(data, 'Could not read design file.'));
    }

    return response.text();
  }

  fileUrl(name: string): string | null {
    if (!this.projectId) return null;
    return `/api/projects/${encodeURIComponent(this.projectId)}/files/${encodeURIComponent(name)}`;
  }

  async uploadFiles(files: File[]): Promise<ChatAttachment[]> {
    if (files.length === 0) return [];

    const attachments: ChatAttachment[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(this.projectId ? `/api/projects/${encodeURIComponent(this.projectId)}/files` : '/api/assets', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(readErrorMessage(data, 'Could not upload design files.'));
      }

      const uploadedFile = readUploadedFile(data);
      attachments.push({
        path: uploadedFile?.path ?? file.name,
        name: uploadedFile?.name ?? file.name,
        kind: file.type.startsWith('image/') || uploadedFile?.kind === 'image' ? 'image' : 'file',
        size: file.size,
        mimeType: file.type || uploadedFile?.mime,
      });
    }

    return attachments;
  }
}

function readProjectFiles(data: unknown): ProjectFile[] {
  const rows = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.files) ? data.files : [];
  return rows.flatMap((row) => {
    const file = readProjectFile(row);
    return file ? [file] : [];
  });
}

function readAttachments(data: unknown): ChatAttachment[] {
  const rows = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.attachments) ? data.attachments : [];
  return rows.flatMap((row) => (isChatAttachment(row) ? [row] : []));
}

function readUploadedFile(data: unknown): ProjectFile | null {
  const file = isObject(data) ? data.file : data;
  return readProjectFile(file);
}

function isChatAttachment(value: unknown): value is ChatAttachment {
  return (
    isObject(value) &&
    typeof value.path === 'string' &&
    typeof value.name === 'string' &&
    (value.kind === 'file' || value.kind === 'image')
  );
}

function readErrorMessage(data: unknown, fallbackMessage: string): string {
  if (!isObject(data)) {
    return fallbackMessage;
  }

  const nestedError = isObject(data.error) ? data.error : null;
  if (typeof nestedError?.message === 'string' && nestedError.message.trim()) {
    return nestedError.message;
  }

  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }

  return fallbackMessage;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
