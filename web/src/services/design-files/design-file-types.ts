import type { ChatAttachment, ProjectFile } from '../../types';

export interface DesignFileApi {
  listFiles(): Promise<ProjectFile[]>;
  readFileContent(name: string): Promise<string>;
  fileUrl(name: string): string | null;
  saveFileContent(name: string, content: string): Promise<ProjectFile>;
  uploadFiles(files: File[]): Promise<ChatAttachment[]>;
}

export type { ChatAttachment, ProjectFile };
