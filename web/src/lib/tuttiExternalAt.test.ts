// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTuttiExternalAtTriggerProviders,
  queryTuttiExternalAtMentions,
  renderTuttiExternalAtInsert,
  type TuttiExternalAtQueryResult,
} from './tuttiExternalAt';

afterEach(() => {
  delete (window as Window & { tuttiExternal?: unknown }).tuttiExternal;
});

describe('tuttiExternalAt', () => {
  it('queries workspace-app and agent-target independently and normalizes returned items', async () => {
    const query = vi.fn(async (input: { providers?: readonly string[] }) => {
      if (input.providers?.[0] === 'workspace-app') {
        return [
          workspaceAppResult(),
          {
            ...workspaceAppResult(),
            providerId: 'agent-target',
            itemId: 'codex',
            label: 'Codex',
          },
        ];
      }

      return [
        agentTargetResult(),
        {
          ...agentTargetResult(),
          providerId: 'workspace-app',
          itemId: 'automation',
          label: 'Automation',
        },
      ];
    });
    (window as Window & {
      tuttiExternal?: {
        at?: {
          query: typeof query;
        };
      };
    }).tuttiExternal = {
      at: { query },
    };

    const items = await queryTuttiExternalAtMentions({ keyword: 'auto', maxResults: 20 });

    expect(query).toHaveBeenNthCalledWith(1, {
      keyword: 'auto',
      maxResults: 20,
      providers: ['workspace-app'],
    });
    expect(query).toHaveBeenNthCalledWith(2, {
      keyword: 'auto',
      maxResults: 20,
      providers: ['agent-target'],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'tutti-external-at:workspace-app:automation',
      kind: 'workspace-app',
      source: 'tutti-external-at',
      label: 'Automation',
    });
    expect(items[1]).toMatchObject({
      id: 'tutti-external-at:agent-target:codex',
      kind: 'agent-target',
      source: 'tutti-external-at',
      label: 'Codex',
    });
  });

  it('renders workspace app mention insert results as stable rich-text markdown', () => {
    expect(renderTuttiExternalAtInsert(workspaceAppResult())).toBe(
      '[@Automation](mention://workspace-app/automation?workspaceId=workspace-1)',
    );
  });

  it('resolves existing mentions using only the identity provider', async () => {
    const query = vi.fn(async () => [agentTargetResult()]);
    (window as Window & {
      tuttiExternal?: {
        at?: {
          query: typeof query;
        };
      };
    }).tuttiExternal = {
      at: { query },
    };

    const provider = createTuttiExternalAtTriggerProviders().find((item) => item.id === 'agent-target');
    const resolved = await provider?.resolveMention?.({
      entityId: 'codex',
      label: 'Codex',
      providerId: 'agent-target',
    });

    expect(query).toHaveBeenCalledWith({
      keyword: 'Codex',
      maxResults: 50,
      providers: ['agent-target'],
    });
    expect(resolved).toEqual({
      label: 'Codex',
      presentation: {
        agentIconUrl: '/assets/codex.png',
        subtitle: 'Agent target',
      },
    });
  });
});

function workspaceAppResult(): TuttiExternalAtQueryResult & {
  id: string;
  kind: 'workspace-app';
  source: 'tutti-external-at';
} {
  return {
    providerId: 'workspace-app',
    itemId: 'automation',
    id: 'tutti-external-at:workspace-app:automation',
    kind: 'workspace-app',
    source: 'tutti-external-at',
    label: 'Automation',
    subtitle: 'Workspace app',
    thumbnailUrl: '/assets/automation.png',
    insert: {
      kind: 'mention',
      mention: {
        entityId: 'automation',
        label: 'Automation',
        scope: {
          workspaceId: 'workspace-1',
        },
        presentation: {
          iconUrl: '/assets/automation.png',
          subtitle: 'Workspace app',
        },
      },
    },
  };
}

function agentTargetResult(): TuttiExternalAtQueryResult & {
  id: string;
  kind: 'agent-target';
  source: 'tutti-external-at';
} {
  return {
    providerId: 'agent-target',
    itemId: 'codex',
    id: 'tutti-external-at:agent-target:codex',
    kind: 'agent-target',
    source: 'tutti-external-at',
    label: 'Codex',
    subtitle: 'Agent target',
    thumbnailUrl: '/assets/codex.png',
    insert: {
      kind: 'mention',
      mention: {
        entityId: 'codex',
        label: 'Codex',
        presentation: {
          agentIconUrl: '/assets/codex.png',
          subtitle: 'Agent target',
        },
      },
    },
  };
}
