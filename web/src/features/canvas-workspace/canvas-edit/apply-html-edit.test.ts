import { describe, expect, it } from 'vitest';
import { applyStylePatchToHtml, applyTextCommitToHtml } from './apply-html-edit';

describe('applyTextCommitToHtml', () => {
  it('updates text content for a matching data-vd-id and escapes HTML-sensitive characters', () => {
    const html = '<main><h1 data-vd-id="headline">Old</h1><p>Other</p></main>';

    expect(applyTextCommitToHtml(html, 'headline', 'A&B <tag>')).toBe(
      '<main><h1 data-vd-id="headline">A&amp;B &lt;tag&gt;</h1><p>Other</p></main>',
    );
  });

  it('treats replacement patterns in committed text as literal text', () => {
    const html = '<main><h1 data-vd-id="headline">Old</h1><p>Other</p></main>';

    expect(applyTextCommitToHtml(html, 'headline', '$& $1')).toBe(
      '<main><h1 data-vd-id="headline">$&amp; $1</h1><p>Other</p></main>',
    );
  });

  it('replaces nested target markup through the matching closing tag', () => {
    const html = '<main><button data-vd-id="cta"><span>Old</span></button><p>Other</p></main>';

    expect(applyTextCommitToHtml(html, 'cta', 'New')).toBe(
      '<main><button data-vd-id="cta">New</button><p>Other</p></main>',
    );
  });

  it('updates text content for a matching source-path-only target', () => {
    const html = '<main><h1 data-vd-source-path="src/App.tsx:12:4">Old</h1><p>Other</p></main>';

    expect(applyTextCommitToHtml(html, 'src/App.tsx:12:4', 'New')).toBe(
      '<main><h1 data-vd-source-path="src/App.tsx:12:4">New</h1><p>Other</p></main>',
    );
  });

  it('returns the original HTML when the target id is missing', () => {
    const html = '<main><h1 data-vd-id="headline">Old</h1></main>';

    expect(applyTextCommitToHtml(html, 'body-copy', 'New')).toBe(html);
  });

  it('applies text commits to unmarked source elements by generated source path', () => {
    const html = '<main><h1>Hero</h1><p>Lead</p></main>';

    expect(applyTextCommitToHtml(html, 'path-0-1', 'Updated lead')).toBe(
      '<main><h1>Hero</h1><p>Updated lead</p></main>',
    );
  });
});

describe('applyStylePatchToHtml', () => {
  it('merges style properties into a matching data-vd-id target while preserving unrelated styles', () => {
    const html = '<main><h1 data-vd-id="headline" style="margin: 0; color: #111111">Hero</h1></main>';

    expect(applyStylePatchToHtml(html, 'headline', { color: '#123456', 'font-size': '18px' })).toBe(
      '<main><h1 data-vd-id="headline" style="margin: 0; color: #123456; font-size: 18px">Hero</h1></main>',
    );
  });

  it('removes empty style properties from a matching source-path target', () => {
    const html =
      '<main><p data-vd-source-path="src/App.tsx:12:4" style="opacity: 0.5; color: #111111">Lead</p></main>';

    expect(applyStylePatchToHtml(html, 'src/App.tsx:12:4', { color: '' })).toBe(
      '<main><p data-vd-source-path="src/App.tsx:12:4" style="opacity: 0.5">Lead</p></main>',
    );
  });

  it('adds a style attribute when the target has no existing inline styles', () => {
    const html = '<main><h1 data-vd-id="headline">Hero</h1></main>';

    expect(applyStylePatchToHtml(html, 'headline', { color: '#123456' })).toBe(
      '<main><h1 data-vd-id="headline" style="color: #123456">Hero</h1></main>',
    );
  });

  it('applies style patches to unmarked source elements by generated source path', () => {
    const html = '<main><h1>Hero</h1><p>Lead</p></main>';

    expect(applyStylePatchToHtml(html, 'path-0-1', { color: '#123456' })).toBe(
      '<main><h1>Hero</h1><p style="color: #123456">Lead</p></main>',
    );
  });

  it('applies style patches to ordinary id targets emitted by inspect mode', () => {
    const html = '<main><strong id="mrr">$428K</strong></main>';

    expect(applyStylePatchToHtml(html, 'mrr', { 'background-image': 'url("/assets/background.png")' })).toBe(
      '<main><strong id="mrr" style="background-image: url(&quot;/assets/background.png&quot;)">$428K</strong></main>',
    );
  });

  it('applies style patches to inspect DOM path targets without data-vd ids', () => {
    const html = '<html><body><div class="page"><main><section class="dashboard">Hero</section></main></div></body></html>';

    expect(
      applyStylePatchToHtml(
        html,
        'html>body>div:nth-of-type(1)>main:nth-of-type(1)>section:nth-of-type(1)',
        { 'background-image': 'url("/assets/background.png")' },
      ),
    ).toBe(
      '<html><body><div class="page"><main><section class="dashboard" style="background-image: url(&quot;/assets/background.png&quot;)">Hero</section></main></div></body></html>',
    );
  });

  it('applies style patches to inspect body DOM path targets', () => {
    const html = '<html><body class="page">Hero</body></html>';

    expect(
      applyStylePatchToHtml(html, 'html>body', { 'background-image': 'url("/assets/background.png")' }),
    ).toBe(
      '<html><body class="page" style="background-image: url(&quot;/assets/background.png&quot;)">Hero</body></html>',
    );
  });

  it('normalizes camelCase style properties before serializing inline styles', () => {
    const html = '<main><h1 data-vd-id="headline">Hero</h1></main>';

    expect(applyStylePatchToHtml(html, 'headline', { fontWeight: '700', lineHeight: '1.5' })).toBe(
      '<main><h1 data-vd-id="headline" style="font-weight: 700; line-height: 1.5">Hero</h1></main>',
    );
  });

  it('escapes quotes in serialized style attribute values', () => {
    const html = '<main><h1 data-vd-id="headline">Hero</h1></main>';

    expect(applyStylePatchToHtml(html, 'headline', { 'background-image': 'url("/assets/background.png")' })).toBe(
      '<main><h1 data-vd-id="headline" style="background-image: url(&quot;/assets/background.png&quot;)">Hero</h1></main>',
    );
  });

  it('preserves inline style values that contain semicolons while merging patches', () => {
    const html = '<main><h1 data-vd-id="headline" style="background-image: url(&quot;/assets/a;b.png&quot;); color: #111111">Hero</h1></main>';

    expect(applyStylePatchToHtml(html, 'headline', { color: '#123456' })).toBe(
      '<main><h1 data-vd-id="headline" style="background-image: url(&quot;/assets/a;b.png&quot;); color: #123456">Hero</h1></main>',
    );
  });

  it('maps inspector layout aliases to real CSS properties before serializing inline styles', () => {
    const html = '<main><section data-vd-id="panel">Panel</section></main>';

    expect(
      applyStylePatchToHtml(html, 'panel', {
        positionType: 'absolute',
        positionX: '12px',
        positionY: '24px',
        positionRight: '8px',
        positionBottom: '16px',
        positionZ: '3',
        flexDirection: 'column',
        flexWrap: 'nowrap',
        justifyContent: 'center',
        alignItems: 'flex-end',
        gridTemplateColumns: 'repeat(3, 1fr)',
      }),
    ).toBe(
      '<main><section data-vd-id="panel" style="position: absolute; left: 12px; top: 24px; right: 8px; bottom: 16px; z-index: 3; flex-direction: column; flex-wrap: nowrap; justify-content: center; align-items: flex-end; grid-template-columns: repeat(3, 1fr)">Panel</section></main>',
    );
  });

  it('returns the original HTML when the style target is missing', () => {
    const html = '<main><h1 data-vd-id="headline">Hero</h1></main>';

    expect(applyStylePatchToHtml(html, 'body-copy', { color: '#123456' })).toBe(html);
  });
});
