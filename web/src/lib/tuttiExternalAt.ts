import { createRichTextMentionMarkdown } from '@tutti-os/ui-rich-text/core';

export type TuttiExternalAtProviderId =
  | 'agent-generated-file'
  | 'agent-session'
  | 'file'
  | 'workspace-app'
  | 'workspace-issue';

export type TuttiExternalAtMentionPresentation = {
  agentProviderId?: string;
  agentIconUrl?: string;
  iconUrl?: string;
  thumbnailUrl?: string;
  subtitle?: string;
  description?: string;
  participant?: string;
  status?: string;
  statusDataStatus?: string;
  statusLabel?: string;
  statusPulse?: string;
  userAvatarPlaceholderUrl?: string;
};

export type TuttiExternalAtInsertResult =
  | {
      kind: 'mention';
      mention: {
        entityId: string;
        label: string;
        scope?: Readonly<Record<string, string>>;
        presentation?: TuttiExternalAtMentionPresentation;
      };
    }
  | {
      kind: 'markdown-link';
      label: string;
      href: string;
    }
  | {
      kind: 'text';
      text: string;
    };

export type TuttiExternalAtQueryResult = {
  providerId: TuttiExternalAtProviderId;
  itemId: string;
  label: string;
  subtitle?: string;
  thumbnailUrl?: string | null;
  insert: TuttiExternalAtInsertResult;
};

export type TuttiExternalAtMentionItem = TuttiExternalAtQueryResult & {
  id: string;
  kind: 'workspace-app';
  source: 'tutti-external-at';
};

type TuttiExternalAtBridge = {
  at?: {
    query(input: {
      keyword: string;
      maxResults?: number;
      providers?: readonly TuttiExternalAtProviderId[];
    }): Promise<readonly TuttiExternalAtQueryResult[]> | readonly TuttiExternalAtQueryResult[];
  };
};

const agentComposerAtProviderIds = ['workspace-app'] as const satisfies readonly TuttiExternalAtMentionItem['kind'][];

export async function queryTuttiExternalAtMentions(input: {
  keyword: string;
  maxResults?: number;
}): Promise<TuttiExternalAtMentionItem[]> {
  if (typeof window === 'undefined') {
    return [];
  }

  const bridge = (window as Window & { tuttiExternal?: TuttiExternalAtBridge }).tuttiExternal?.at;
  if (!bridge) {
    return [];
  }

  try {
    const items = await Promise.resolve(
      bridge.query({
        keyword: input.keyword,
        maxResults: input.maxResults,
        providers: agentComposerAtProviderIds,
      }),
    );
    return items.flatMap((item) => normalizeTuttiExternalAtMentionItem(item));
  } catch {
    return [];
  }
}

export function isTuttiExternalAtMentionItem(value: unknown): value is TuttiExternalAtMentionItem {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<TuttiExternalAtMentionItem>).source === 'tutti-external-at',
  );
}

export function renderTuttiExternalAtInsert(item: TuttiExternalAtMentionItem): string {
  const insert = item.insert;
  if (insert.kind === 'mention') {
    return createRichTextMentionMarkdown({
      entityId: insert.mention.entityId,
      label: insert.mention.label,
      providerId: item.providerId,
      scope: insert.mention.scope,
    });
  }
  if (insert.kind === 'markdown-link') {
    return createMarkdownLink(insert.label, insert.href);
  }
  return insert.text;
}

export function getTuttiExternalAtMentionIconUrl(item: TuttiExternalAtMentionItem): string | null {
  const insert = item.insert;
  const presentation = insert.kind === 'mention' ? insert.mention.presentation : undefined;
  return (
    presentation?.iconUrl?.trim() ||
    presentation?.thumbnailUrl?.trim() ||
    presentation?.agentIconUrl?.trim() ||
    item.thumbnailUrl?.trim() ||
    null
  );
}

export function getTuttiExternalAtMentionSubtitle(item: TuttiExternalAtMentionItem): string | null {
  const insert = item.insert;
  const presentation = insert.kind === 'mention' ? insert.mention.presentation : undefined;
  return item.subtitle?.trim() || presentation?.subtitle?.trim() || null;
}

function normalizeTuttiExternalAtMentionItem(
  item: TuttiExternalAtQueryResult,
): TuttiExternalAtMentionItem[] {
  if (!agentComposerAtProviderIds.includes(item.providerId as TuttiExternalAtMentionItem['kind'])) {
    return [];
  }
  if (!item.itemId || !item.label) {
    return [];
  }
  return [
    {
      ...item,
      id: `tutti-external-at:${item.providerId}:${item.itemId}`,
      kind: item.providerId as TuttiExternalAtMentionItem['kind'],
      source: 'tutti-external-at',
    },
  ];
}

function createMarkdownLink(label: string, href: string): string {
  const normalizedLabel = label.trim();
  const normalizedHref = href.trim();
  if (!normalizedLabel || !normalizedHref) {
    return '';
  }
  return `[${escapeMarkdownLinkLabel(normalizedLabel)}](${escapeMarkdownLinkHref(normalizedHref)})`;
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function escapeMarkdownLinkHref(value: string): string {
  return value.replace(/\\/g, '%5C').replace(/\(/g, '%28').replace(/\)/g, '%29');
}
