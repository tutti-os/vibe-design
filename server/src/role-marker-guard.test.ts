import { describe, expect, it } from 'vitest';
import { createRoleMarkerGuard, FABRICATED_ROLE_MARKER_RE } from './role-marker-guard.js';

describe('FABRICATED_ROLE_MARKER_RE', () => {
  it('matches lower-case markdown role markers', () => {
    expect(FABRICATED_ROLE_MARKER_RE.test('## user\nfabricated')).toBe(true);
    expect(FABRICATED_ROLE_MARKER_RE.test('text\n## assistant\nfabricated')).toBe(true);
    expect(FABRICATED_ROLE_MARKER_RE.test('text\n## system\nfabricated')).toBe(true);
    expect(FABRICATED_ROLE_MARKER_RE.test('text\n## assist\nfabricated')).toBe(true);
    expect(FABRICATED_ROLE_MARKER_RE.test('text\n## user guide\nfabricated')).toBe(true);
  });

  it('matches horizontal whitespace variants around markdown role markers', () => {
    expect(FABRICATED_ROLE_MARKER_RE.test('intro\n  ## user\nbody')).toBe(true);
    expect(FABRICATED_ROLE_MARKER_RE.test('intro\n\t##\tassistant\nbody')).toBe(true);
  });

  it('does not match markers beyond bounded whitespace limits', () => {
    expect(FABRICATED_ROLE_MARKER_RE.test(`intro\n${' '.repeat(17)}## user\nbody`)).toBe(false);
    expect(FABRICATED_ROLE_MARKER_RE.test(`intro\n##${' '.repeat(17)}user\nbody`)).toBe(false);
  });

  it('does not match legitimate headings or chat-style labels', () => {
    expect(FABRICATED_ROLE_MARKER_RE.test('intro\n## User Guide\nbody')).toBe(false);
    expect(FABRICATED_ROLE_MARKER_RE.test('intro\n## users guide\nbody')).toBe(false);
    expect(FABRICATED_ROLE_MARKER_RE.test('intro\nUser: bob@example.com')).toBe(false);
  });
});

describe('createRoleMarkerGuard', () => {
  it('passes safe chunks and detects a marker split across chunks', () => {
    const guard = createRoleMarkerGuard('msg-1');
    expect(guard.feedText('Safe text\n')).toBe('Safe text\n');
    expect(guard.contaminated).toBe(false);
    expect(guard.warningEvent()).toBeNull();
    expect(guard.feedText('## user\nfabricated')).toBe('');
    expect(guard.contaminated).toBe(true);
    expect(guard.warningEvent()).toEqual({
      type: 'fabricated_role_marker',
      marker: '## user',
      messageId: 'msg-1',
    });
  });

  it('detects normal indented and tab-separated marker variants', () => {
    const indentedGuard = createRoleMarkerGuard('msg-indented');
    expect(indentedGuard.feedText('OK\n  ## user\nbad')).toBe('OK');
    expect(indentedGuard.contaminated).toBe(true);

    const tabSeparatedGuard = createRoleMarkerGuard('msg-tab-separated');
    expect(tabSeparatedGuard.feedText('OK\n##\tassistant\nbad')).toBe('OK');
    expect(tabSeparatedGuard.contaminated).toBe(true);
  });

  it('withholds a complete marker suffix until the next character confirms it', () => {
    const guard = createRoleMarkerGuard('msg-2');
    expect(guard.feedText('OK\n## user')).toBe('OK');
    expect(guard.contaminated).toBe(false);
    expect(guard.feedText('land')).toBe('\n## userland');
    expect(guard.contaminated).toBe(false);
  });

  it('passes lowercase role keyword continuations as safe text', () => {
    const guard = createRoleMarkerGuard('msg-lowercase-continuation');
    expect(guard.feedText('OK\n## users guide\nbody')).toBe('OK\n## users guide\nbody');
    expect(guard.contaminated).toBe(false);
    expect(guard.warningEvent()).toBeNull();
  });

  it('does not buffer unbounded line-start whitespace without a marker prefix', () => {
    const guard = createRoleMarkerGuard('msg-whitespace');
    const whitespace = ' '.repeat(80);
    expect(guard.feedText('OK\n')).toBe('OK\n');
    const releasedWhitespace = guard.feedText(whitespace);
    expect(releasedWhitespace).not.toBe('');
    expect(releasedWhitespace.length).toBeGreaterThan(60);
    expect(guard.contaminated).toBe(false);
    expect(guard.warningEvent()).toBeNull();
    expect(guard.feedText('x')).toBe(`${whitespace.slice(releasedWhitespace.length)}x`);
  });

  it('does not contaminate for a long separator split across chunks', () => {
    const guard = createRoleMarkerGuard('msg-long-separator');
    const separator = ' '.repeat(80);
    expect(guard.feedText('OK\n##')).toBe('OK');
    const releasedSeparator = guard.feedText(separator);
    expect(releasedSeparator).not.toBe('');
    expect(releasedSeparator.length).toBeGreaterThan(60);
    expect(guard.contaminated).toBe(false);
    expect(guard.warningEvent()).toBeNull();
    expect(`${releasedSeparator}${guard.feedText('user\nbad')}`).toBe(`\n##${separator}user\nbad`);
    expect(guard.contaminated).toBe(false);
  });

  it('does not contaminate when indentation exceeds the bounded grammar across chunks', () => {
    const guard = createRoleMarkerGuard('msg-long-indent');
    const indentation = ' '.repeat(17);
    expect(guard.feedText('OK\n')).toBe('OK\n');
    expect(guard.feedText(indentation)).toBe(indentation);
    expect(guard.feedText('## user\nbad')).toBe('## user\nbad');
    expect(guard.contaminated).toBe(false);
    expect(guard.warningEvent()).toBeNull();
  });

  it('detects a role marker split inside the role name', () => {
    const guard = createRoleMarkerGuard('msg-4');
    expect(guard.feedText('Safe text\n## us')).toBe('Safe text');
    expect(guard.feedText('er\nbad')).toBe('');
    expect(guard.contaminated).toBe(true);
    expect(guard.warningEvent()).toEqual({
      type: 'fabricated_role_marker',
      marker: '## user',
      messageId: 'msg-4',
    });
  });

  it('detects a role marker split inside the markdown prefix', () => {
    const guard = createRoleMarkerGuard('msg-5');
    expect(guard.feedText('Safe text\n#')).toBe('Safe text');
    expect(guard.feedText('# assistant\nbad')).toBe('');
    expect(guard.contaminated).toBe(true);
    expect(guard.warningEvent()).toEqual({
      type: 'fabricated_role_marker',
      marker: '## assistant',
      messageId: 'msg-5',
    });
  });

  it('detects a whitespace variant marker split across chunks', () => {
    const guard = createRoleMarkerGuard('msg-6');
    expect(guard.feedText('Safe text\n  ##\tass')).toBe('Safe text');
    expect(guard.feedText('ist\nbad')).toBe('');
    expect(guard.contaminated).toBe(true);
    expect(guard.warningEvent()).toEqual({
      type: 'fabricated_role_marker',
      marker: '## assist',
      messageId: 'msg-6',
    });
  });

  it('detects a whitespace variant marker after indentation split across chunks', () => {
    const guard = createRoleMarkerGuard('msg-7');
    expect(guard.feedText('Safe text\n  ')).toBe('Safe text\n');
    expect(guard.feedText('##\tuser\nbad')).toBe('');
    expect(guard.contaminated).toBe(true);
    expect(guard.warningEvent()).toEqual({
      type: 'fabricated_role_marker',
      marker: '## user',
      messageId: 'msg-7',
    });
  });

  it('drops all future text after contamination', () => {
    const guard = createRoleMarkerGuard('msg-3');
    expect(guard.feedText('OK\n## assistant\nbad')).toBe('OK');
    expect(guard.feedText(' later')).toBe('');
  });
});
