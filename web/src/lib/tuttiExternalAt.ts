import { createRichTextMentionMarkdown } from '@tutti-os/ui-rich-text/core';
import type {
  RichTextMentionIdentity,
  RichTextMentionResolved,
  RichTextTriggerProvider,
} from '@tutti-os/ui-rich-text/types';

export type TuttiExternalAtProviderId =
  | 'agent-target'
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
  kind: TuttiExternalAtComposerProviderId;
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

export const TUTTI_EXTERNAL_AT_COMPOSER_PROVIDER_IDS = [
  'workspace-app',
  'agent-target',
] as const satisfies readonly TuttiExternalAtProviderId[];

export type TuttiExternalAtComposerProviderId = (typeof TUTTI_EXTERNAL_AT_COMPOSER_PROVIDER_IDS)[number];

export async function queryTuttiExternalAtMentions(input: {
  keyword: string;
  maxResults?: number;
  providers?: readonly TuttiExternalAtComposerProviderId[];
}): Promise<TuttiExternalAtMentionItem[]> {
  const providers = input.providers ?? TUTTI_EXTERNAL_AT_COMPOSER_PROVIDER_IDS;
  const results = await Promise.all(
    providers.map((providerId) =>
      queryTuttiExternalAtProvider({
        keyword: input.keyword,
        maxResults: input.maxResults,
        providerId,
      }),
    ),
  );
  return results.flat();
}

export function createTuttiExternalAtTriggerProviders(): RichTextTriggerProvider<TuttiExternalAtMentionItem>[] {
  return TUTTI_EXTERNAL_AT_COMPOSER_PROVIDER_IDS.map((providerId) =>
    createTuttiExternalAtTriggerProvider(providerId),
  );
}

function createTuttiExternalAtTriggerProvider(
  providerId: TuttiExternalAtComposerProviderId,
): RichTextTriggerProvider<TuttiExternalAtMentionItem> {
  return {
    id: providerId,
    trigger: '@',
    boundary: 'punctuation',
    query(input) {
      return queryTuttiExternalAtProvider({
        keyword: input.keyword,
        maxResults: input.maxResults,
        providerId,
      });
    },
    getItemKey: (item) => item.itemId,
    getItemLabel: (item) => item.label,
    getItemSubtitle: (item) => getTuttiExternalAtMentionSubtitle(item),
    getItemIconUrl: (item) => getTuttiExternalAtMentionIconUrl(item),
    toInsertResult: (item) => item.insert,
    resolveMention(identity) {
      if (identity.providerId !== providerId) {
        return null;
      }
      return resolveTuttiExternalAtMention(identity);
    },
  };
}

async function queryTuttiExternalAtProvider(input: {
  keyword: string;
  maxResults?: number;
  providerId: TuttiExternalAtComposerProviderId;
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
        providers: [input.providerId],
      }),
    );
    return items.flatMap((item) => normalizeTuttiExternalAtMentionItem(item, input.providerId));
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

async function resolveTuttiExternalAtMention(
  identity: RichTextMentionIdentity,
): Promise<RichTextMentionResolved | null> {
  const providerId = identity.providerId as TuttiExternalAtComposerProviderId;
  if (!TUTTI_EXTERNAL_AT_COMPOSER_PROVIDER_IDS.includes(providerId)) {
    return null;
  }

  const candidates = await queryTuttiExternalAtMentions({
    keyword: identity.label || identity.entityId,
    maxResults: 50,
    providers: [providerId],
  });
  const match = candidates.find((item) => isSameMentionIdentity(item, identity));
  if (!match || match.insert.kind !== 'mention') {
    return null;
  }

  return {
    label: match.insert.mention.label || match.label,
    presentation: match.insert.mention.presentation,
  };
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
  expectedProviderId: TuttiExternalAtComposerProviderId,
): TuttiExternalAtMentionItem[] {
  if (item.providerId !== expectedProviderId) {
    return [];
  }
  if (!item.itemId || !item.label) {
    return [];
  }
  return [
    {
      ...item,
      id: `tutti-external-at:${item.providerId}:${item.itemId}`,
      kind: item.providerId,
      source: 'tutti-external-at',
    },
  ];
}

function isSameMentionIdentity(
  item: TuttiExternalAtMentionItem,
  identity: RichTextMentionIdentity,
): boolean {
  if (item.providerId !== identity.providerId) {
    return false;
  }

  if (item.itemId === identity.entityId) {
    return true;
  }

  return item.insert.kind === 'mention' && item.insert.mention.entityId === identity.entityId;
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
