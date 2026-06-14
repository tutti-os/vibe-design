import { Button, Card, CardContent, Spinner } from '@tutti-os/ui-system/components';
import { CheckIcon, CloseIcon, LoadingIcon } from '@tutti-os/ui-system/icons';
import React from 'react';
import type { CSSProperties } from 'react';
import type { GenerationPhase, GenerationPreviewStageState, StageStep } from '../runtime/generation-preview';
import { type TranslateFn, useTranslation } from '../i18n';

export interface GenerationPreviewStageProps {
  state: GenerationPreviewStageState;
  onRetry?: (() => void) | undefined;
}

export function GenerationPreviewStage({ state, onRetry }: GenerationPreviewStageProps) {
  const { t } = useTranslation();
  if (!state.visible || state.phase === 'ready') return null;

  const title =
    state.phase === 'generate' && state.projectKind
      ? t('generation.phaseTitles.generateKind', { kind: state.projectKind })
      : phaseTitle(state.phase, t);

  return (
    <section
      style={stageStyle}
      data-phase={state.phase}
      data-testid="generation-preview-stage"
      aria-live="polite"
      aria-busy={state.phase !== 'failed' && state.phase !== 'waiting'}
    >
      <Card style={cardStyle}>
        <CardContent style={bodyStyle}>
          <header style={headerStyle}>
            <span style={markStyle(state.phase)} data-phase={state.phase} aria-hidden>
              {state.phase === 'failed' ? <CloseIcon size={24} /> : <Spinner size={24} />}
            </span>
            <div style={copyStyle}>
              <h1 style={titleStyle}>{title}</h1>
              {state.activityLabel ? <p style={leadStyle}>{state.activityLabel}</p> : null}
            </div>
          </header>

          <ol style={stepsStyle}>
            {state.steps.map((step) => (
              <StepIndicator key={step.id} step={step} />
            ))}
          </ol>

          {state.todoProgress ? (
            <div style={todoProgressStyle}>
              <span
                style={{
                  ...todoProgressFillStyle,
                  width: `${Math.round((state.todoProgress.done / state.todoProgress.total) * 100)}%`,
                }}
              />
              <span style={todoProgressLabelStyle}>
                {t('generation.tasks', { done: state.todoProgress.done, total: state.todoProgress.total })}
              </span>
            </div>
          ) : null}

          {state.phase === 'failed' ? (
            <div role="alert" style={errorStyle}>
              {t('generation.error')}
            </div>
          ) : null}

          {state.phase === 'failed' && onRetry ? (
            <Button type="button" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function StepIndicator({ step }: { step: StageStep }) {
  const { t } = useTranslation();

  return (
    <li style={stepStyle(step.status)} data-status={step.status}>
      <span style={stepIconStyle} aria-hidden>
        {step.status === 'succeeded' ? (
          <CheckIcon size={12} />
        ) : step.status === 'failed' ? (
          <CloseIcon size={12} />
        ) : step.status === 'running' ? (
          <LoadingIcon size={12} />
        ) : (
          <span style={pendingDotStyle} />
        )}
      </span>
      <span>{stageStepLabel(step, t)}</span>
      {step.detail ? <span style={stepDetailStyle}>{step.detail}</span> : null}
    </li>
  );
}

function phaseTitle(phase: Exclude<GenerationPhase, 'ready'>, t: TranslateFn): string {
  if (phase === 'understand') return t('generation.phaseTitles.understand');
  if (phase === 'generate') return t('generation.phaseTitles.generate');
  if (phase === 'prepare') return t('generation.phaseTitles.prepare');
  if (phase === 'waiting') return t('generation.phaseTitles.waiting');
  return t('generation.phaseTitles.failed');
}

function stageStepLabel(step: StageStep, t: TranslateFn): string {
  if (step.id === 'understand') return t('generation.steps.understand');
  if (step.id === 'generate') return t('generation.steps.generate');
  if (step.id === 'prepare') return t('generation.steps.prepare');
  return step.label;
}

const stageStyle: CSSProperties = {
  minHeight: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 32px',
  transition: 'opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)',
};

const cardStyle: CSSProperties = {
  width: 'min(480px, 100%)',
};

const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 16,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

const copyStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const titleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--text-primary)',
  fontSize: 20,
  lineHeight: 1.25,
  fontWeight: 600,
};

const leadStyle: CSSProperties = {
  margin: 0,
  color: 'var(--muted-foreground)',
  fontSize: 14,
  lineHeight: 1.5,
};

const stepsStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const todoProgressStyle: CSSProperties = {
  position: 'relative',
  minHeight: 24,
  overflow: 'hidden',
  borderRadius: 999,
  background: 'var(--muted)',
};

const todoProgressFillStyle: CSSProperties = {
  position: 'absolute',
  insetBlock: 0,
  insetInlineStart: 0,
  borderRadius: 'inherit',
  background: 'var(--primary)',
  transition: 'width 300ms ease-out',
};

const todoProgressLabelStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  justifyContent: 'center',
  padding: '3px 10px',
  color: 'var(--primary-foreground)',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
};

const errorStyle: CSSProperties = {
  color: 'var(--destructive)',
  fontSize: 14,
};

const stepIconStyle: CSSProperties = {
  display: 'inline-flex',
  width: 16,
  justifyContent: 'center',
};

const stepDetailStyle: CSSProperties = {
  color: 'var(--muted-foreground)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const pendingDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  border: '1px solid var(--muted-foreground)',
};

function markStyle(phase: GenerationPhase): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    flex: '0 0 auto',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
    background: 'var(--background)',
    color: phase === 'failed' ? 'var(--destructive)' : 'var(--text-primary)',
  };
}

function stepStyle(status: StageStep['status']): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '16px minmax(0, max-content) minmax(0, 1fr)',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    color:
      status === 'failed'
        ? 'var(--destructive)'
        : status === 'succeeded'
          ? 'var(--text-primary)'
          : 'var(--text-secondary)',
  fontSize: 12,
  transition: 'opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
  opacity: status === 'pending' ? 0.62 : 1,
  transform: status === 'pending' ? 'scale(0.96)' : 'scale(1)',
  };
}
