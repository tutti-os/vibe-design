import React from 'react';
import { SwatchBook } from 'lucide-react';
import { Button } from '@tutti-os/ui-system/components';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@tutti-os/ui-system/components';
import { CheckIcon, ChevronDownIcon, LoadingIcon } from '@tutti-os/ui-system/icons';

export type ComposerModelProvider = string;

const MODEL_PROVIDER_ICON_URLS: Record<string, string> = {
  codex: '/assets/agent-icons/workspace-dock-agent-codex.png',
  'claude-code': '/assets/agent-icons/workspace-dock-agent-claude-code.png',
  cursor: '/assets/agent-icons/workspace-dock-agent-cursor.png',
  opencode: '/assets/agent-icons/workspace-dock-agent-opencode.png',
  tutti: '/assets/agent-icons/manage-agent-tutti.png',
  hermes: '/assets/agent-icons/hermes-rounded.png',
  openclaw: '/assets/agent-icons/openclaw-rounded.png',
};

function modelProviderIconUrl(provider: ComposerModelProvider): string {
  return MODEL_PROVIDER_ICON_URLS[provider] ?? MODEL_PROVIDER_ICON_URLS.tutti;
}

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
  const iconUrl = modelProviderIconUrl(provider);
  return (
    <img
      key={iconUrl}
      src={iconUrl}
      alt=""
      aria-hidden
      className="composer-model-provider-icon"
      data-provider-icon={provider}
      title={provider}
      onError={(event) => {
        const image = event.currentTarget;
        if (image.dataset.fallbackApplied === 'true') return;
        image.dataset.fallbackApplied = 'true';
        image.src = MODEL_PROVIDER_ICON_URLS.tutti;
      }}
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

export interface ComposerModelGroup {
  provider: ComposerModelProvider;
  iconProvider?: ComposerModelProvider;
  providerLabel: string;
  models: Array<{
    id: string;
    label: string | null;
    description?: string;
  }>;
}

export function ComposerModelPicker({
  ariaLabel,
  groups,
  selectedKey,
  selectedProvider,
  selectedIconProvider,
  selectedProviderLabel,
  selectedModelLabel,
  menuClassName,
  onOpenMenu,
  onSelect,
  additionalItems,
}: {
  ariaLabel: string;
  groups: ComposerModelGroup[];
  selectedKey: string;
  selectedProvider: ComposerModelProvider;
  selectedIconProvider?: ComposerModelProvider;
  selectedProviderLabel: string;
  selectedModelLabel: string | null;
  menuClassName?: string;
  onOpenMenu?: () => void;
  onSelect: (provider: ComposerModelProvider, modelId: string) => void;
  additionalItems?: React.ReactNode;
}) {
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) onOpenMenu?.(); }}>
      <DropdownMenuTrigger asChild>
        <ComposerModelTrigger
          ariaLabel={ariaLabel}
          provider={selectedIconProvider ?? selectedProvider}
          providerLabel={selectedProviderLabel}
          modelLabel={selectedModelLabel}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={menuClassName}
        align="end"
        side="top"
        style={{ width: 'min(320px, calc(100vw - 24px))' }}
      >
        {groups.map((group) => {
          if (group.models.length === 0) {
            return (
              <React.Fragment key={group.provider}>
                <DropdownMenuItem
                  className="composer-model-menu-item"
                  data-provider-option={group.provider}
                  onSelect={() => onSelect(group.provider, '')}
                >
                  <ComposerModelProviderIcon provider={group.iconProvider ?? group.provider} />
                  <span>{group.providerLabel}</span>
                </DropdownMenuItem>
              </React.Fragment>
            );
          }

          const hasModelLabels = group.models.some((m) => m.label !== null);

          if (!hasModelLabels) {
            return (
              <React.Fragment key={group.provider}>
                {group.models.map((model) => (
                  <DropdownMenuItem
                    className="composer-model-menu-item"
                    key={`${group.provider}:${model.id}`}
                    data-provider-option={group.provider}
                    data-model-option-id={model.id}
                    onSelect={() => onSelect(group.provider, model.id)}
                  >
                    <ComposerModelProviderIcon provider={group.iconProvider ?? group.provider} />
                    <span>{group.providerLabel}</span>
                  </DropdownMenuItem>
                ))}
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={group.provider}>
              <DropdownMenuLabel
                className="composer-model-provider-label"
                data-provider-option={group.provider}
              >
                <ComposerModelProviderIcon provider={group.iconProvider ?? group.provider} />
                <span>{group.providerLabel}</span>
              </DropdownMenuLabel>
              <div className="composer-model-provider-models" data-provider-models={group.provider}>
                {group.models.map((model) => (
                  <DropdownMenuItem
                    className="composer-model-menu-item composer-model-menu-item--model"
                    data-model-option-id={model.id}
                    key={model.id}
                    onSelect={() => onSelect(group.provider, model.id)}
                  >
                    <span className="composer-model-menu-check" aria-hidden>
                      {selectedKey === `${group.provider}:${model.id}` ? <CheckIcon size={12} /> : null}
                    </span>
                    <span className="composer-model-menu-option-text">
                      <span className="composer-model-menu-option-label">{model.label}</span>
                      {model.description ? (
                        <span className="composer-model-menu-option-description">{model.description}</span>
                      ) : null}
                    </span>
                  </DropdownMenuItem>
                ))}
              </div>
            </React.Fragment>
          );
        })}
        {additionalItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
