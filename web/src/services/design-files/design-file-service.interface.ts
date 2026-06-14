import { createDecorator } from '@tutti-os/infra/di';
import type { ChatAttachment, ProjectFile } from './design-file-types';

export type DesignFileChangeEvent =
  | {
      type: 'saved';
      file: ProjectFile;
      content: string;
    }
  | {
      type: 'uploaded';
      attachments: ChatAttachment[];
    };

export interface IDesignFileService {
  readonly _serviceBrand: undefined;
  subscribe(listener: (event: DesignFileChangeEvent) => void): () => void;
  listFiles(): Promise<ProjectFile[]>;
  readFileContent(name: string): Promise<string>;
  fileUrl(name: string): string | null;
  saveFileContent(name: string, content: string): Promise<ProjectFile>;
  uploadFiles(files: File[]): Promise<ChatAttachment[]>;
}

export const IDesignFileService = createDecorator<IDesignFileService>('design-file-service');
