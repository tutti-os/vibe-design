import { createDecorator } from '@tutti-os/infra/di';
import type {
  ContextPickerSnapshot,
  ContextSearchResult,
  ContextSearchResultItem,
  RunContextSelection,
} from './context-picker-types';

export interface IContextPickerService {
  readonly _serviceBrand: undefined;
  subscribe(listener: () => void): () => void;
  search(query: string): Promise<ContextSearchResult>;
  selectSkill(skillId: string): Promise<void>;
  selectDesignFile(designFileId: string): Promise<void>;
  selectResult(item: ContextSearchResultItem): Promise<void>;
  removeSelection(kind: ContextSearchResultItem['kind'], id: string): void;
  buildRunContext(): RunContextSelection | undefined;
  getSnapshot(): ContextPickerSnapshot;
}

export const IContextPickerService = createDecorator<IContextPickerService>('context-picker-service');
