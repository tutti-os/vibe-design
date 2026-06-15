import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(fileURLToPath(new URL('./chat-ui.css', import.meta.url)), 'utf8');

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  return pattern.exec(chatCss)?.[1] ?? '';
}

function ruleBodies(selector: string): string[] {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  return Array.from(chatCss.matchAll(pattern), (match) => match[1]);
}

describe('chat-ui.css', () => {
  it('keeps the chat pane constrained so the message log can scroll inside the left panel', () => {
    const paneRule = ruleBody('.pane');
    const chatLogRule = ruleBody('.chat-log');

    expect(paneRule).toContain('height: 100%');
    expect(paneRule).toContain('overflow: hidden');
    expect(chatLogRule).toContain('overflow-y: auto');
    expect(chatLogRule).toContain('padding: 16px 20px');
  });

  it('keeps the active conversation title in a compact header without mode tabs', () => {
    const headerRule = ruleBody('.chat-header');

    expect(headerRule).toContain("'title actions'");
    expect(headerRule).not.toContain("'tabs tabs'");
    expect(headerRule).toContain('padding: 7px 10px');
    expect(headerRule).not.toContain('border-bottom');
    expect(chatCss).not.toContain('.chat-mode-tabs');
    expect(chatCss).not.toContain('.chat-mode-tab');
  });

  it('uses borderless header icon buttons and only reveals rename on title hover or focus', () => {
    const iconRule = ruleBody('.chat-active-conversation-rename,\n.chat-header .icon-only');
    const renameRule = ruleBody('.chat-active-conversation-rename');

    expect(iconRule).toContain('border: none');
    expect(iconRule).toContain('background: transparent');
    expect(renameRule).toContain('opacity: 0');
    expect(renameRule).toContain('pointer-events: none');
    expect(chatCss).toContain('.chat-active-conversation:hover .chat-active-conversation-rename');
    expect(chatCss).toContain('.chat-active-conversation:focus-within .chat-active-conversation-rename');
    expect(chatCss).toContain('.chat-active-conversation-rename:focus-visible');
  });

  it('keeps user bubbles constrained and breakable for long prompts', () => {
    const userTextRule = ruleBody('.msg.user .user-text');

    expect(userTextRule).not.toContain('width: max-content');
    expect(userTextRule).toContain('overflow-wrap: anywhere');
  });

  it('keeps queued turn cards complete by scrolling inside the queue preview area', () => {
    const queuedTurnsRule = ruleBody('.queued-turns');

    expect(queuedTurnsRule).toContain('min-height: 0');
    expect(queuedTurnsRule).toContain('max-height: min(34vh, 220px)');
    expect(queuedTurnsRule).toContain('overflow-y: auto');
    expect(queuedTurnsRule).toContain('overflow-x: hidden');
    expect(queuedTurnsRule).toContain('overscroll-behavior: contain');
  });

  it('keeps many staged input attachments inside a scrollable input area', () => {
    const stagedAttachmentsRule = ruleBody('.chat-composer__input-attachments');

    expect(stagedAttachmentsRule).toContain('max-height: 96px');
    expect(stagedAttachmentsRule).toContain('overflow-y: scroll');
    expect(stagedAttachmentsRule).toContain('overscroll-behavior: contain');
    expect(stagedAttachmentsRule).toContain('scrollbar-gutter: stable');
    expect(stagedAttachmentsRule).toContain('scrollbar-width: thin');
    expect(chatCss).toContain('.chat-composer__input-attachments::-webkit-scrollbar-thumb');
  });

  it('keeps queued turn messages to one line until hover or focus reveals the full content', () => {
    const plainRule = ruleBody('.queued-turn__plain,\n.queued-turn .user-text,\n.queued-turn .user-preview-comment-message');
    const revealRule = ruleBody('.queued-turn:hover .queued-turn__plain,\n.queued-turn:focus-within .queued-turn__plain,\n.queued-turn:hover .user-text,\n.queued-turn:focus-within .user-text,\n.queued-turn:hover .user-preview-comment-message,\n.queued-turn:focus-within .user-preview-comment-message');

    expect(plainRule).toContain('overflow: hidden');
    expect(plainRule).toContain('text-overflow: ellipsis');
    expect(plainRule).toContain('white-space: nowrap');
    expect(revealRule).toContain('overflow: visible');
    expect(revealRule).toContain('white-space: pre-wrap');
  });

  it('does not duplicate queue height as message-log padding', () => {
    const queuedLogRule = ruleBody('.pane--has-queued-turns .chat-log');

    expect(queuedLogRule).toBe('');
    expect(chatCss).not.toContain('--chat-queued-turns-reserved-height');
  });

  it('keeps queued turn action buttons out of the truncated message width', () => {
    const bodyRule = ruleBody('.queued-turn__body');
    const actionsRule = ruleBody('.queued-turn__actions');

    expect(bodyRule).toContain('min-width: 0');
    expect(bodyRule).toContain('flex: 1');
    expect(actionsRule).toContain('flex: 0 0 auto');
    expect(actionsRule).toContain('margin-left: auto');
  });

  it('keeps queued turn file context chips inside the queue card width', () => {
    const summaryRule = ruleBody('.queued-turn__summary');
    const contextRule = ruleBody('.queued-turn .user-skill-context');
    const chipsRule = ruleBody('.queued-turn .user-skill-context__chips');
    const fileChipRule = ruleBody('.queued-turn .user-attachment-file');
    const fileChipTextRule = ruleBody('.queued-turn .user-attachment-file span');

    expect(summaryRule).toContain('flex: 1');
    expect(contextRule).toContain('min-width: 0');
    expect(contextRule).toContain('width: 100%');
    expect(chipsRule).toContain('flex: 1');
    expect(fileChipRule).toContain('width: 100%');
    expect(fileChipRule).toContain('max-width: 100%');
    expect(fileChipRule).toContain('overflow: hidden');
    expect(fileChipRule).toContain('min-width: 0');
    expect(fileChipRule).toContain('flex-shrink: 1');
    expect(fileChipTextRule).toContain('display: block');
    expect(fileChipTextRule).toContain('min-width: 0');
    expect(fileChipTextRule).toContain('overflow: hidden');
    expect(fileChipTextRule).toContain('text-overflow: ellipsis');
    expect(fileChipTextRule).toContain('white-space: nowrap');
  });

  it('right-aligns user image attachments within the message block', () => {
    const attachmentsRule = ruleBody('.user-attachments');
    const imageButtonRule = ruleBody('.user-attachment-image-button');

    expect(attachmentsRule).toContain('width: fit-content');
    expect(attachmentsRule).toContain('align-self: flex-end');
    expect(attachmentsRule).toContain('align-items: flex-end');
    expect(imageButtonRule).toContain('display: inline-flex');
    expect(imageButtonRule).toContain('width: fit-content');
    expect(imageButtonRule).not.toContain('display: block');
  });

  it('lets user messages with attachments span the chat row so attachments can reach the right edge', () => {
    const attachedMessageRule = ruleBody('.msg.user.msg--has-attachments');

    expect(attachedMessageRule).toContain('align-self: stretch');
    expect(attachedMessageRule).toContain('width: 100%');
    expect(attachedMessageRule).toContain('max-width: 100%');
  });

  it('wraps user attachment groups in one foreground surface', () => {
    const attachedWrapRule = ruleBody('.msg.user.msg--has-attachments .user-text-wrap');

    expect(attachedWrapRule).toContain('width: fit-content');
    expect(attachedWrapRule).toContain('max-width: 100%');
    expect(attachedWrapRule).toContain('align-self: flex-end');
    expect(attachedWrapRule).toContain('border: 1px solid var(--project-message-border)');
    expect(attachedWrapRule).toContain('border-radius: var(--project-radius-lg)');
    expect(attachedWrapRule).toContain('background: var(--background-fronted)');
    expect(attachedWrapRule).toContain('padding: 10px');
  });

  it('left-aligns preview comment screenshot thumbnails within their message details', () => {
    const imageButtonRule = ruleBody('.preview-comment-attachment-image-button');

    expect(imageButtonRule).toContain('justify-self: start');
    expect(imageButtonRule).not.toContain('justify-self: end');
  });

  it('constrains preview comment attachment details inside the chat pane', () => {
    const commentAttachmentsRule = ruleBody('.user-comment-attachments');
    const commentDetailRule = ruleBody('.preview-comment-attachment-detail');
    const commentDetailTextRule = ruleBody('.preview-comment-attachment-text');

    expect(commentAttachmentsRule).toContain('width: 100%');
    expect(commentDetailRule).toContain('width: 100%');
    expect(commentDetailRule).toContain('max-width: 100%');
    expect(commentDetailRule).toContain('min-width: 0');
    expect(commentDetailRule).toContain('flex-shrink: 1');
    expect(commentDetailTextRule).toContain('overflow-wrap: anywhere');
  });

  it('groups preview comment attachments into one user message bubble', () => {
    const commentAttachmentsRule = ruleBody('.user-comment-attachments');
    const groupedDetailRule = ruleBody('.user-comment-attachments .preview-comment-attachment-detail');
    const followingDetailRule = ruleBody('.user-comment-attachments .preview-comment-attachment-detail + .preview-comment-attachment-detail');

    expect(commentAttachmentsRule).toContain('border: 1px solid var(--project-message-border)');
    expect(commentAttachmentsRule).toContain('border-radius: 8px');
    expect(commentAttachmentsRule).toContain('background: var(--background-fronted)');
    expect(commentAttachmentsRule).toContain('padding: 7px 10px');
    expect(groupedDetailRule).toContain('border: 0');
    expect(groupedDetailRule).toContain('border-radius: 0');
    expect(groupedDetailRule).toContain('background: transparent');
    expect(groupedDetailRule).toContain('padding: 0');
    expect(followingDetailRule).toContain('border-top: 1px solid var(--project-message-border)');
  });

  it('lets assistant messages use the full chat row width', () => {
    const assistantRule = ruleBody('.msg.assistant');
    const markdownRule = ruleBody('.chat-message__markdown');

    expect(assistantRule).toContain('width: 100%');
    expect(assistantRule).not.toContain('620px');
    expect(markdownRule).not.toContain('max-width: 62ch');
  });

  it('renders thinking markdown inside the chat row', () => {
    const thinkingContentRule = ruleBody('.chat-message__thinking-content');
    const markdownRule = ruleBody('.chat-message__markdown');

    expect(thinkingContentRule).toContain('min-width: 0');
    expect(thinkingContentRule).toContain('border: 1px solid var(--project-border, var(--border-1))');
    expect(thinkingContentRule).toContain('border-radius: 8px');
    expect(thinkingContentRule).toContain('padding: 10px 12px');
    expect(thinkingContentRule).toContain('overflow-wrap: anywhere');
    expect(thinkingContentRule).toContain('font-family: inherit');
    expect(markdownRule).toContain('white-space: normal');
  });

  it('wraps markdown code blocks instead of adding horizontal scrolling', () => {
    const preRule = ruleBodies('.chat-message__markdown pre').at(-1) ?? '';

    expect(preRule).toContain('overflow-x: hidden');
    expect(preRule).not.toContain('overflow: auto');
    expect(preRule).toContain('white-space: pre-wrap');
    expect(preRule).toContain('overflow-wrap: anywhere');
    expect(preRule).toContain('word-break: break-word');
  });

  it('wraps agent errors in an inset surface inside the assistant row', () => {
    const errorRule = ruleBody('.chat-message__error');
    const surfaceRule = ruleBody('.chat-message__error-surface');

    expect(errorRule).toContain('width: 100%');
    expect(surfaceRule).toContain('border: 1px solid var(--project-danger-border)');
    expect(surfaceRule).toContain('background: var(--project-danger-surface)');
    expect(surfaceRule).toContain('padding: 10px 12px');
    expect(surfaceRule).toContain('border-radius: 8px');
  });

  it('restores markdown list markers after the global CSS reset', () => {
    const unorderedRules = ruleBodies('.chat-message__markdown ul');
    const orderedRules = ruleBodies('.chat-message__markdown ol');

    expect(unorderedRules.some((rule) => rule.includes('list-style: disc'))).toBe(true);
    expect(orderedRules.some((rule) => rule.includes('list-style: decimal'))).toBe(true);
  });

  it('lets inline question forms use the full assistant message width', () => {
    const questionFormRule = ruleBody('.question-form-card');

    expect(questionFormRule).toContain('width: 100%');
    expect(questionFormRule).not.toContain('520px');
  });

  it('wraps AskUserQuestion options into compact two-line rows', () => {
    const optionRule = ruleBody('.tool-card__options > button');
    const optionTextRule = ruleBody('.tool-card__options > button > span');
    const optionMetaRule = ruleBody('.tool-card__options > button > .tool-card__meta');

    expect(optionRule).toContain('display: grid');
    expect(optionRule).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(optionRule).toContain('justify-content: start');
    expect(optionRule).toContain('height: auto');
    expect(optionRule).toContain('width: 100%');
    expect(optionRule).toContain('white-space: normal');
    expect(optionTextRule).toContain('min-width: 0');
    expect(optionTextRule).toContain('overflow-wrap: anywhere');
    expect(optionTextRule).not.toContain('text-overflow: ellipsis');
    expect(optionTextRule).not.toContain('white-space: nowrap');
    expect(optionMetaRule).toContain('font-size: var(--project-font-caption)');
    expect(optionMetaRule).toContain('line-height: 16px');
  });

  it('uses a strong selected state for AskUserQuestion options', () => {
    const selectedOptionRule = ruleBody(".tool-card__options > button[aria-pressed='true']");
    const selectedHoverRule = ruleBody(".tool-card__options > button[aria-pressed='true']:hover:not(:disabled)");

    expect(selectedOptionRule).toContain('border-color: var(--project-primary)');
    expect(selectedOptionRule).toContain('background: var(--project-primary-alpha-16)');
    expect(selectedOptionRule).toContain('color: var(--project-accent)');
    expect(selectedOptionRule).toContain('font-weight: var(--project-font-weight-strong)');
    expect(selectedHoverRule).toContain('background: var(--project-primary-alpha-24)');
  });

  it('lays out question form options as full-width readable rows for long labels', () => {
    const optionsRule = ruleBody('.question-form-card__options');
    const optionRule = ruleBody('.question-form-card__option');
    const optionTextRule = ruleBody('.question-form-card__option span');

    expect(optionsRule).toContain('display: grid');
    expect(optionRule).toContain('height: auto');
    expect(optionRule).toContain('align-items: flex-start');
    expect(optionTextRule).toContain('min-width: 0');
    expect(optionTextRule).toContain('overflow-wrap: anywhere');
    expect(optionTextRule).not.toContain('text-overflow: ellipsis');
    expect(optionTextRule).not.toContain('white-space: nowrap');
  });

  it('wraps long question form prompts instead of truncating them', () => {
    const labelRule = ruleBody('.question-form-card__label');
    const labelTextRule = ruleBody('.question-form-card__label > span:first-child');

    expect(labelRule).toContain('flex-wrap: wrap');
    expect(labelTextRule).toContain('min-width: 0');
    expect(labelTextRule).toContain('overflow-wrap: anywhere');
    expect(labelTextRule).not.toContain('text-overflow: ellipsis');
    expect(labelTextRule).not.toContain('white-space: nowrap');
  });

  it('uses project tokens and a strong selected state for question form options', () => {
    const questionFormRule = ruleBody('.question-form-card');
    const optionRule = ruleBody('.question-form-card__option');
    const selectedOptionRule = ruleBody(".question-form-card__option[aria-pressed='true']");
    const selectedHoverRule = ruleBody(".question-form-card__option[aria-pressed='true']:hover:not(:disabled)");

    expect(questionFormRule).toContain('background: var(--background-fronted)');
    expect(questionFormRule).not.toContain('color-mix');
    expect(optionRule).toContain('border-color: var(--border-1)');
    expect(optionRule).toContain('background: var(--project-input-bg)');
    expect(optionRule).toContain('color: var(--text-primary)');
    expect(selectedOptionRule).toContain('border-color: var(--project-primary)');
    expect(selectedOptionRule).toContain('background: var(--project-primary-alpha-16)');
    expect(selectedOptionRule).toContain('color: var(--project-accent)');
    expect(selectedOptionRule).toContain('box-shadow: var(--project-shadow-none)');
    expect(selectedOptionRule).not.toContain('inset 0 0 0 1px');
    expect(selectedOptionRule).toContain('font-weight: var(--project-font-weight-strong)');
    expect(selectedHoverRule).toContain('background: var(--project-primary-alpha-24)');
  });

  it('uses shared primary alpha tokens for warm accent surfaces', () => {
    const exampleHoverRule = ruleBody('.chat-example:hover');
    const exampleIconRule = ruleBody('.chat-example-icon');

    expect(exampleHoverRule).toContain('border-color: var(--project-primary-alpha-24)');
    expect(exampleIconRule).toContain('background: var(--project-primary-alpha-10)');
    expect(exampleIconRule).toContain('color: var(--primary)');
  });

  it('keeps question form footers visually compact like Claude Design', () => {
    const footerMetaRule = ruleBody('.question-form-card__footer .tool-card__meta');
    const submitRule = ruleBody('.question-form-card__footer button');

    expect(chatCss).toContain('.question-form-card__footer {\n  padding-block: 8px;\n  font-size: var(--project-font-caption);\n  line-height: 16px;\n}');
    expect(footerMetaRule).toContain('font-size: var(--project-font-caption)');
    expect(submitRule).toContain('height: 24px');
    expect(submitRule).toContain('font-size: var(--project-font-caption)');
  });

  it('sizes model provider icons large enough to read in the composer selector', () => {
    const triggerRule = ruleBody('.composer-model-menu-trigger');
    const triggerProviderRule = ruleBody('.composer-model-menu-trigger-provider');
    const triggerModelRule = ruleBody('.composer-model-menu-trigger-model');
    const triggerIconRule = ruleBody('.composer-model-menu-chevron');
    const contentRule = ruleBody('.composer-model-menu-content');
    const providerLabelRule = ruleBody('.composer-model-provider-label');
    const providerModelsRule = ruleBody('.composer-model-provider-models');
    const modelItemRule = ruleBody('.composer-model-menu-item--model');
    const optionTextRule = ruleBody('.composer-model-menu-option-text');
    const optionDescriptionRule = ruleBodies('.composer-model-menu-option-description').at(-1) ?? '';
    const contentItemRule = ruleBody(".composer-model-menu-content [data-slot='dropdown-menu-item'],\n.composer-model-menu-item");
    const disabledItemRule = ruleBody(".composer-model-menu-item[data-disabled],\n.composer-model-menu-content [data-slot='dropdown-menu-item'][data-disabled]");
    const disabledItemIconRule = ruleBody(".composer-model-menu-item[data-disabled] .composer-model-provider-icon,\n.composer-model-menu-content [data-slot='dropdown-menu-item'][data-disabled] .composer-model-provider-icon");
    const providerIconRule = ruleBody('.composer-model-provider-icon');
    const tooltipTriggerRule = ruleBody('.composer-model-menu-tooltip-trigger');

    expect(triggerRule).toContain('display: inline-flex');
    expect(triggerRule).toContain('width: 178px');
    expect(triggerRule).toContain('max-width: 52vw');
    expect(triggerRule).toContain('padding-inline: 4px');
    expect(triggerProviderRule).toContain('max-width: 72px');
    expect(triggerModelRule).toContain('text-overflow: ellipsis');
    expect(triggerIconRule).toContain('color: var(--text-placeholder)');
    expect(triggerIconRule).toContain('opacity: 1');
    expect(contentRule).toContain('min-width: 280px');
    expect(contentRule).toContain('max-width: min(380px, calc(100vw - 24px))');
    expect(providerLabelRule).toContain('font-weight: var(--project-font-weight-semibold)');
    expect(providerModelsRule).toContain('display: grid');
    expect(modelItemRule).toContain('padding-left: 24px');
    expect(modelItemRule).toContain('align-items: flex-start');
    expect(optionTextRule).toContain('display: grid');
    expect(optionDescriptionRule).toContain('white-space: normal');
    expect(optionDescriptionRule).toContain('color: var(--text-secondary)');
    expect(chatCss).not.toContain('.composer-model-menu-subcontent');
    expect(contentItemRule).toContain('padding-left: 4px');
    expect(contentItemRule).toContain('padding-right: 4px');
    expect(tooltipTriggerRule).toContain('display: block');
    expect(tooltipTriggerRule).toContain('width: 100%');
    expect(providerIconRule).toContain('width: 20px');
    expect(providerIconRule).toContain('height: 20px');
    expect(chatCss).not.toContain('.composer-model-provider-icon--svg');
    expect(disabledItemRule).toContain('cursor: not-allowed');
    expect(disabledItemRule).toContain('color: var(--text-disabled)');
    expect(disabledItemIconRule).toContain('filter: grayscale(1)');
    expect(chatCss).not.toContain('.composer-model-menu-trigger:disabled .composer-model-provider-icon');
    expect(chatCss).not.toContain(".composer-model-menu-trigger[aria-disabled='true'] .composer-model-provider-icon");
  });

  it('does not grey out the composer model selector trigger when model switching is locked', () => {
    expect(chatCss).not.toContain('.composer-model-menu-trigger:disabled .composer-model-provider-icon');
    expect(chatCss).not.toContain(".composer-model-menu-trigger[aria-disabled='true'] .composer-model-provider-icon");
    expect(chatCss).not.toContain('.composer-model-menu-trigger:disabled > svg:last-child');
    expect(chatCss).not.toContain(".composer-model-menu-trigger[aria-disabled='true'] > svg:last-child");
  });

  it('floats mention results above the composer input without changing input height', () => {
    const mentionRule = ruleBody('.chat-composer__mention-list');
    const mentionButtonRule = ruleBody('.chat-composer__mention-button');
    const mentionTextRule = ruleBody('.chat-composer__mention-button > span');

    expect(mentionRule).toContain('position: absolute');
    expect(mentionRule).toContain('bottom: calc(100% + 8px)');
    expect(mentionRule).toContain('z-index: 30');
    expect(mentionRule).toContain('overflow-y: auto');
    expect(mentionRule).toContain('padding: 4px');
    expect(mentionRule).not.toContain('margin-top: 6px');
    expect(mentionButtonRule).toContain('max-width: 100%');
    expect(mentionButtonRule).toContain('overflow: hidden');
    expect(mentionTextRule).toContain('min-width: 0');
    expect(mentionTextRule).toContain('text-overflow: ellipsis');
    expect(mentionTextRule).toContain('white-space: nowrap');
  });

  it('lets the design system Done action use the shared primary button styling', () => {
    const doneRule = ruleBody('.chat-composer__design-system-done');

    expect(doneRule).toContain('min-width: 60px');
    expect(doneRule).not.toContain('background:');
    expect(doneRule).not.toContain('color:');
    expect(chatCss).not.toContain('.chat-composer__design-system-done:hover');
  });

  it('keeps the design system picker wide enough for option names and swatches', () => {
    const dialogRule = ruleBody('.chat-composer__design-system-dialog');

    expect(dialogRule).toContain('width: min(480px, calc(100vw - 48px))');
    expect(dialogRule).toContain('max-width: min(480px, calc(100vw - 48px))');
  });

  it('constrains the design system option list so overflow scrolls inside the dialog', () => {
    const sidebarRule = ruleBody('.chat-composer__design-system-sidebar');
    const availableSectionRule = ruleBody('.chat-composer__design-system-section--available');
    const selectedCardRule = ruleBody('.chat-composer__design-system-selected-card');
    const selectedEmptyRule = ruleBody('.chat-composer__design-system-selected-empty');
    const listRule = ruleBody('.chat-composer__design-system-list');

    expect(sidebarRule).toContain('overflow: hidden');
    expect(availableSectionRule).toContain('flex: 1');
    expect(availableSectionRule).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(selectedCardRule).toContain('grid-template-columns: minmax(0, 1fr) auto auto');
    expect(selectedCardRule).toContain('border-radius: var(--project-button-radius)');
    expect(selectedCardRule).toContain('padding: 11px 4px 11px 12px');
    expect(selectedCardRule).toContain('box-shadow: var(--project-shadow-none)');
    expect(selectedEmptyRule).toContain('border-radius: var(--project-button-radius)');
    expect(selectedEmptyRule).not.toContain('border-radius: var(--project-radius-xl)');
    expect(listRule).toContain('min-height: 0');
    expect(listRule).toContain('overflow-y: auto');
    expect(chatCss).not.toContain('chat-composer__design-system-default-badge');
    expect(chatCss).not.toContain('chat-composer__design-system-selected-card--clearable');
    expect(chatCss).not.toContain('.chat-composer__design-system-reorder-hint');
  });

  it('uses the project warm surface tokens for the preview comments panel', () => {
    const panelRule = ruleBody('.preview-comments-panel');
    const bodyRule = ruleBody('.preview-comments-panel__body');
    const emptyRule = ruleBody('.preview-comments-panel__empty');
    const commentRecordsListRule = ruleBody('.preview-comment-records__list');
    const commentRecordRule = ruleBody('.preview-comment-record');

    expect(panelRule).toContain('background: var(--project-surface, var(--background))');
    expect(bodyRule).toContain('display: flex');
    expect(bodyRule).toContain('flex-direction: column');
    expect(emptyRule).toContain('min-height: 100%');
    expect(emptyRule).toContain('align-items: center');
    expect(emptyRule).toContain('justify-content: center');
    expect(commentRecordsListRule).toContain('grid-auto-rows: max-content');
    expect(commentRecordsListRule).toContain('align-content: start');
    expect(commentRecordsListRule).toContain('width: 100%');
    expect(chatCss).not.toContain('.preview-comments-panel__header');
    expect(ruleBody('.preview-comments-panel__composer')).toContain('border-top: 1px solid var(--border-1)');
    expect(ruleBody('.preview-comments-panel__composer-shell')).toContain('justify-content: flex-end');
    expect(ruleBody('.preview-comments-panel__send-button')).toContain('height: 30px');
    expect(commentRecordRule).toContain('border: 1px solid var(--project-border, var(--border-1))');
    expect(commentRecordRule).toContain('background: var(--project-card, var(--background-fronted))');
    expect(commentRecordRule).toContain('align-items: center');
    expect(ruleBody('.preview-comment-record__actions')).toContain('align-items: center');
    expect(ruleBody('.preview-comment-record__actions')).toContain('align-self: center');
    expect(ruleBody('.preview-comment-record__open-button')).toContain('background: var(--background)');
    expect(ruleBody('.preview-comment-record__open-button')).toContain('color: var(--text-primary)');
  });

  it('uses warm input surfaces while keeping the composer and user messages flat white', () => {
    const pageRule = ruleBody('.project-editor-page');
    const renameRule = ruleBody('.chat-active-conversation-input');
    const renameHoverRule = ruleBody('.chat-active-conversation-input:hover');
    const composerOuterRule = ruleBody('.composer');
    const composerRule = ruleBody('.composer-shell');
    const composerHoverRule = ruleBody('.composer-shell:hover');
    const composerFocusRule = ruleBody('.composer-shell:focus-within');
    const designSystemTriggerRule = ruleBody('.chat-composer__design-system-trigger');
    const userMessageRule = ruleBody('.msg.user .user-text');

    expect(pageRule).toContain('--project-input-bg: rgb(246 244 241)');
    expect(pageRule).toContain('--project-input-hover-bg: rgb(246 244 241)');
    expect(renameRule).toContain('background: var(--project-input-bg)');
    expect(renameRule).toContain('border-radius: 6px');
    expect(renameRule).not.toContain('border-radius: var(--project-radius-lg)');
    expect(renameHoverRule).toContain('background: var(--project-input-hover-bg)');
    expect(composerOuterRule).toContain('border-top: 0');
    expect(composerOuterRule).toContain('padding: 0 12px 12px');
    expect(composerRule).toContain('background: var(--background-fronted)');
    expect(composerRule).toContain('padding: 12px');
    expect(composerRule).toContain('box-shadow: var(--project-shadow-none)');
    expect(composerHoverRule).toContain('background: var(--background-fronted)');
    expect(composerFocusRule).toContain('border-color: var(--project-border, var(--border-1))');
    expect(composerFocusRule).not.toContain('border-color: color-mix');
    expect(designSystemTriggerRule).toContain('padding: 0 6px 0 2px');
    expect(designSystemTriggerRule).toContain('color: var(--project-accent)');
    expect(userMessageRule).toContain('background: var(--background-fronted)');
    expect(userMessageRule).toContain('border: 1px solid var(--project-message-border)');
    expect(userMessageRule).toContain('border-radius: 8px');
    expect(userMessageRule).toContain('box-shadow: var(--project-shadow-none)');
  });

  it('uses the accent color for the design system composer trigger', () => {
    const designSystemTriggerRule = ruleBody('.chat-composer__design-system-trigger');
    const designSystemTriggerHoverRule = ruleBody('.chat-composer__design-system-trigger:hover');

    expect(designSystemTriggerRule).toContain('color: var(--project-accent)');
    expect(designSystemTriggerHoverRule).toContain('background: transparent');
    expect(designSystemTriggerHoverRule).toContain('color: var(--project-accent)');
    expect(designSystemTriggerRule).not.toContain('color: var(--text-secondary)');
    expect(designSystemTriggerHoverRule).not.toContain('background: var(--project-primary-alpha-8)');
    expect(designSystemTriggerHoverRule).not.toContain('color: var(--text-primary)');
  });

  it('uses a single accent treatment for selected question form options', () => {
    const selectedOptionRule = ruleBody(".question-form-card__option[aria-pressed='true']");

    expect(selectedOptionRule).toContain('border-color: var(--project-primary)');
    expect(selectedOptionRule).toContain('color: var(--project-accent)');
    expect(selectedOptionRule).toContain('box-shadow: var(--project-shadow-none)');
    expect(selectedOptionRule).not.toContain('inset 0 0 0 1px');
  });

  it('uses the project accent color for the assistant running spinner', () => {
    const runningIconRule = ruleBody('.chat-message__running-icon');

    expect(runningIconRule).toContain('color: var(--project-accent)');
    expect(runningIconRule).not.toContain('color: var(--warning)');
  });

  it('wraps long tool command previews inside the card instead of horizontal scrolling', () => {
    const detailsRule = ruleBody('.tool-card__details');
    const commandRule = ruleBody('.tool-card__summary-command');

    expect(detailsRule).toContain('overflow-x: hidden');
    expect(commandRule).not.toContain('overflow: hidden');
    expect(commandRule).not.toContain('text-overflow: ellipsis');
    expect(commandRule).not.toContain('width: max-content');
    expect(commandRule).toContain('max-width: 100%');
    expect(commandRule).toContain('white-space: normal');
    expect(commandRule).toContain('overflow-wrap: anywhere');
  });

  it('allows long tool rows to wrap within the card width', () => {
    const rowRule = ruleBody('.tool-card__row');
    const metaRule = ruleBody('.tool-card__row .tool-card__meta');

    expect(rowRule).toContain('flex-wrap: wrap');
    expect(metaRule).toContain('min-width: 0');
    expect(metaRule).toContain('overflow-wrap: anywhere');
  });

  it('wraps generated file names instead of truncating them', () => {
    const fileNameRule = ruleBody('.tool-card__file-name');

    expect(fileNameRule).toContain('min-width: 0');
    expect(fileNameRule).toContain('white-space: normal');
    expect(fileNameRule).toContain('overflow-wrap: anywhere');
    expect(fileNameRule).not.toContain('text-overflow: ellipsis');
  });

  it('keeps generated file rows wrapping within the card width', () => {
    const rowRule = ruleBody('.tool-card__generated-row');
    const mainRule = ruleBody('.tool-card__generated-main');
    const mainChildrenRule = ruleBody('.tool-card__generated-main > button,\n.tool-card__generated-main > .tool-card__meta');

    expect(rowRule).toContain('display: grid');
    expect(rowRule).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(mainRule).toContain('min-width: 0');
    expect(mainRule).toContain('max-width: 100%');
    expect(mainChildrenRule).toContain('max-width: 100%');
  });
});
