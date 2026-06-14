import type { DesignFileChangeEvent, IDesignFileService } from '../design-file-service.interface';
import type { ChatAttachment, DesignFileApi, ProjectFile } from '../design-file-types';

export class DesignFileService implements IDesignFileService {
  readonly _serviceBrand = undefined;
  private readonly listeners = new Set<(event: DesignFileChangeEvent) => void>();

  constructor(private readonly api: DesignFileApi) {}

  subscribe(listener: (event: DesignFileChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  listFiles(): Promise<ProjectFile[]> {
    return this.api.listFiles();
  }

  readFileContent(name: string): Promise<string> {
    return this.api.readFileContent(name);
  }

  fileUrl(name: string): string | null {
    return this.api.fileUrl(name);
  }

  async saveFileContent(name: string, content: string): Promise<ProjectFile> {
    const file = await this.api.saveFileContent(name, content);
    this.emit({ type: 'saved', file, content });
    return file;
  }

  async uploadFiles(files: File[]): Promise<ChatAttachment[]> {
    const attachments = await this.api.uploadFiles(files);
    if (attachments.length > 0) {
      this.emit({ type: 'uploaded', attachments });
    }
    return attachments;
  }

  private emit(event: DesignFileChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
