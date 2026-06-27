// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  queryTuttiExternalAtMentions,
  renderTuttiExternalAtInsert,
  type TuttiExternalAtQueryResult,
} from './tuttiExternalAt';

afterEach(() => {
  delete (window as Window & { tuttiExternal?: unknown }).tuttiExternal;
});

describe('tuttiExternalAt', () => {
  it('queries the workspace-app at provider and normalizes returned items', async () => {
    const query = vi.fn(async () => [
      workspaceAppResult(),
      {
        ...workspaceAppResult(),
        providerId: 'agent-session',
        itemId: 'session-1',
        label: 'Session',
      },
    ]);
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

    expect(query).toHaveBeenCalledWith({
      keyword: 'auto',
      maxResults: 20,
      providers: ['workspace-app'],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'tutti-external-at:workspace-app:automation',
      kind: 'workspace-app',
      source: 'tutti-external-at',
      label: 'Automation',
    });
  });

  it('renders workspace app mention insert results as stable rich-text markdown', () => {
    expect(renderTuttiExternalAtInsert(workspaceAppResult())).toBe(
      '[@Automation](mention://workspace-app/automation?workspaceId=workspace-1)',
    );
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
