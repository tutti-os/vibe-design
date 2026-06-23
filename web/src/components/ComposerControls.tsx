import React from 'react';
import { SwatchBook } from 'lucide-react';
import { Button } from '@tutti-os/ui-system/components';
import { ChevronDownIcon, LoadingIcon } from '@tutti-os/ui-system/icons';

export type ComposerModelProvider = 'codex' | 'claude-code' | 'tutti' | 'hermes' | 'openclaw';

const MODEL_PROVIDER_ICON_URLS: Record<ComposerModelProvider, string> = {
  codex: '/assets/agent-icons/workspace-dock-agent-codex.png',
  'claude-code': '/assets/agent-icons/workspace-dock-agent-claude-code.png',
  tutti: '/assets/agent-icons/manage-agent-tutti.png',
  hermes: '/assets/agent-icons/hermes-rounded.png',
  openclaw: '/assets/agent-icons/openclaw-rounded.png',
};

export function ComposerDesignSystemTrigger({
  ariaLabel,
  label,
  onClick,
}: {
  ariaLabel: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      className="chat-composer__design-system-trigger"
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <SwatchBook size={14} aria-hidden />
      <span>{label}</span>
    </Button>
  );
}

export function ComposerIconButton({
  ariaLabel,
  children,
  disabled = false,
  onClick,
  title,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={ariaLabel}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface ComposerModelTriggerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  ariaLabel: string;
  modelLabel?: string | null;
  provider: ComposerModelProvider;
  providerLabel: string;
}

export const ComposerModelTrigger = React.forwardRef<HTMLButtonElement, ComposerModelTriggerProps>(
  function ComposerModelTrigger(
    {
      ariaLabel,
      className,
      modelLabel,
      provider,
      providerLabel,
      type = 'button',
      ...buttonProps
    },
    ref,
  ) {
    return (
      <button
        {...buttonProps}
        ref={ref}
        type={type}
        aria-label={ariaLabel}
        className={['composer-model-menu-trigger', className].filter(Boolean).join(' ')}
      >
        <ComposerModelProviderIcon provider={provider} />
        <span className="composer-model-menu-trigger-provider">{providerLabel}</span>
        {modelLabel ? (
          <span className="composer-model-menu-trigger-model">{modelLabel}</span>
        ) : null}
        <ChevronDownIcon className="composer-model-menu-chevron" size={14} aria-hidden />
      </button>
    );
  },
);

export function ComposerModelProviderIcon({
  provider,
}: {
  provider: ComposerModelProvider;
}) {
  const iconUrl = MODEL_PROVIDER_ICON_URLS[provider];
  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden
      className="composer-model-provider-icon"
      data-provider-icon={provider}
      title={provider}
    />
  );
}

export function ComposerSendButton({
  ariaLabel,
  children,
  disabled = false,
  loading = false,
  onClick,
  stop = false,
  title,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  stop?: boolean;
  title?: string;
}) {
  return (
    <Button
      type="button"
      className={['project-primary-button composer-send', stop ? 'composer-send--stop' : ''].filter(Boolean).join(' ')}
      size="sm"
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? (
        <span className="composer-send-loading-icon">
          <LoadingIcon size={14} title={ariaLabel} />
        </span>
      ) : children}
    </Button>
  );
}
