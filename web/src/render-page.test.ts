import { describe, expect, it } from 'vitest';
import { renderPage } from './render-page';

describe('renderPage', () => {
  it('renders the dashboard route by default', () => {
    const html = renderPage();

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('id="root"');
    expect(html).toContain('<link rel="icon" type="image/png" href="/icon.png">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icon.png">');
    expect(html).toContain('/styles.css');
    expect(html).toContain('Prototype Design');
    expect(html).not.toContain('Research Preview');
    expect(html).toContain('New prototype');
    expect(html).not.toContain('Wireframe');
    expect(html).not.toContain('High fidelity');
    expect(html).toContain('Design style');
    expect(html).toContain('None');
    expect(html).toContain('Search designs');
    expect(html).not.toContain('Community');
    expect(html).not.toContain('Chat 事件流');
  });

  it('renders the project editor route with the migrated chat panel', () => {
    const html = renderPage({
      route: { kind: 'project', projectId: 'demo-project' },
      projectEditor: {
        project: {
          id: 'demo-project',
          title: 'Demo project',
          tabsState: {
            tabs: [{ kind: 'file', key: 'file:home.html', name: 'home.html', path: 'home.html' }],
            activeTabKey: 'file:home.html',
          },
        },
        files: [
          {
            name: 'home.html',
            path: 'home.html',
            kind: 'html',
            mime: 'text/html',
            contents: '<main><h1>Persisted project file</h1></main>',
          },
        ],
        conversations: [{ id: 'conversation-1', title: 'Persisted conversation', createdAt: 1, updatedAt: 2 }],
        activeConversationId: 'conversation-1',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            content: 'Persisted user prompt',
            events: [],
            blocks: [],
            createdAt: 1,
          },
        ],
      },
    });

    expect(html).toContain('Prototype Design');
    expect(html).toContain('vibe-design-chat-ui flex h-full min-h-0 flex-1 flex-col overflow-hidden');
    expect(html).toContain('Chat composer');
    expect(html).toContain('Demo project');
    expect(html).toContain('Persisted conversation');
    expect(html).toContain('Persisted user prompt');
    expect(html).toContain('Project Canvas Workspace');
    expect(html).toContain('Design Files');
    expect(html).toContain('home.html');
    expect(html).toContain('Persisted project file');
    expect(html).toContain('File surface mode');
    expect(html).toContain('Preview');
    expect(html).not.toContain(
      'M12 1C18.0751 1 23 5.92487 23 12C23 18.0751 18.0751 23 12 23C5.92487 23 1 18.0751 1 12C1 5.92487 5.92487 1 12 1ZM3.05664 13',
    );
    expect(html).not.toContain('landing.html');
    expect(html).not.toContain('Open settings');
    expect(html).not.toContain('Share');
    expect(html).not.toContain('Run / SSE');
    expect(html).not.toContain('Skills</span>');
    expect(html).toContain('demo-project');
    expect(html).toContain('/client.js');
    expect(html).not.toContain('GenerationPreviewStage');
  });
});
