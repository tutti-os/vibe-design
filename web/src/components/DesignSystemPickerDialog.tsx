import React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@tutti-os/ui-system/components';
import { CheckIcon, CloseIcon } from '@tutti-os/ui-system/icons';

export interface PickerDesignSystem {
  id: string;
  title: string;
  category: string;
  summary: string;
  swatches: string[];
}

export type DesignSystemPickerLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface DesignSystemPickerDialogText {
  allSelected: string;
  availableLabel: string;
  availableListLabel: string;
  clearSelectionAria: (title: string) => string;
  dialogDescription: string;
  dialogTitle: string;
  done: string;
  emptySelected: string;
  errorFallback: string;
  importHint: string;
  loading: string;
  selectAria: (title: string) => string;
  selectedLabel: string;
  setupPrompt: string;
}

export function DesignSystemPickerDialog({
  disabled = false,
  error,
  loadState,
  open,
  selectedDesignSystem,
  designSystems,
  text,
  selectionError,
  onClearDesignSystem,
  onDone,
  onOpenChange,
  onSelectDesignSystem,
}: {
  disabled?: boolean;
  error: string | null;
  loadState: DesignSystemPickerLoadState;
  open: boolean;
  selectedDesignSystem: PickerDesignSystem | null;
  designSystems: PickerDesignSystem[];
  text: DesignSystemPickerDialogText;
  selectionError?: string | null;
  onClearDesignSystem: () => void;
  onDone?: () => void;
  onOpenChange: (open: boolean) => void;
  onSelectDesignSystem: (designSystemId: string) => void;
}) {
  const availableDesignSystems = designSystems.filter(
    (designSystem) => designSystem.id !== selectedDesignSystem?.id,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="chat-composer__design-system-dialog"
        overlayClassName="chat-composer__design-system-overlay"
        showCloseButton={false}
      >
        <div className="chat-composer__design-system-header">
          <DialogHeader className="chat-composer__design-system-heading">
            <DialogTitle>{text.dialogTitle}</DialogTitle>
            <DialogDescription className="chat-composer__design-system-description">
              {text.dialogDescription}
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            className="project-primary-button chat-composer__design-system-done"
            size="sm"
            onClick={() => {
              if (onDone) {
                onDone();
                return;
              }
              onOpenChange(false);
            }}
          >
            {text.done}
          </Button>
        </div>
        <div className="chat-composer__design-system-body">
          <aside className="chat-composer__design-system-sidebar" aria-label={text.dialogTitle}>
            <div className="chat-composer__design-system-section">
              <span className="chat-composer__design-system-section-label">
                {text.selectedLabel}
              </span>
              {selectedDesignSystem ? (
                <SelectedDesignSystemCard
                  designSystem={selectedDesignSystem}
                  disabled={disabled}
                  onClear={onClearDesignSystem}
                  removeAriaLabel={text.clearSelectionAria(selectedDesignSystem.title)}
                />
              ) : (
                <div className="chat-composer__design-system-selected-empty">
                  {text.emptySelected}
                </div>
              )}
            </div>

            <div className="chat-composer__design-system-section chat-composer__design-system-section--available">
              <span className="chat-composer__design-system-section-label">
                {text.availableLabel}
              </span>
              <div className="chat-composer__design-system-list" aria-label={text.availableListLabel}>
                {loadState === 'loading' ? (
                  <div className="chat-composer__design-system-empty">{text.loading}</div>
                ) : loadState === 'error' ? (
                  <div className="chat-composer__design-system-empty">
                    {error ?? text.errorFallback}
                  </div>
                ) : availableDesignSystems.length > 0 ? (
                  availableDesignSystems.map((designSystem) => (
                    <AvailableDesignSystemOption
                      key={designSystem.id}
                      designSystem={designSystem}
                      disabled={disabled}
                      selected={designSystem.id === selectedDesignSystem?.id}
                      selectAriaLabel={text.selectAria(designSystem.title)}
                      onSelect={() => onSelectDesignSystem(designSystem.id)}
                    />
                  ))
                ) : designSystems.length > 0 ? (
                  <div className="chat-composer__design-system-empty">{text.allSelected}</div>
                ) : (
                  <div className="chat-composer__design-system-empty">
                    <span>{text.setupPrompt}</span>
                    <span>{text.importHint}</span>
                  </div>
                )}
              </div>
            </div>

            {selectionError ? (
              <p className="chat-composer__design-system-error" aria-live="polite">
                {selectionError}
              </p>
            ) : null}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectedDesignSystemCard({
  designSystem,
  disabled,
  onClear,
  removeAriaLabel,
}: {
  designSystem: PickerDesignSystem;
  disabled: boolean;
  onClear(): void;
  removeAriaLabel: string;
}) {
  return (
    <div className="chat-composer__design-system-selected-card">
      <span className="chat-composer__design-system-selected-title">{designSystem.title}</span>
      <Button
        type="button"
        className="chat-composer__design-system-remove"
        size="icon-sm"
        variant="ghost"
        aria-label={removeAriaLabel}
        disabled={disabled}
        onClick={onClear}
      >
        <CloseIcon size={12} aria-hidden />
      </Button>
    </div>
  );
}

function AvailableDesignSystemOption({
  designSystem,
  disabled,
  selected,
  selectAriaLabel,
  onSelect,
}: {
  designSystem: PickerDesignSystem;
  disabled: boolean;
  selected: boolean;
  selectAriaLabel: string;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      className={`chat-composer__design-system-option${
        selected ? ' chat-composer__design-system-option--selected' : ''
      }`}
      aria-label={selectAriaLabel}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="chat-composer__design-system-option-main">
        <span className="chat-composer__design-system-option-title">{designSystem.title}</span>
        <span className="chat-composer__design-system-option-summary">
          {designSystem.summary || designSystem.category}
        </span>
      </span>
      <span className="chat-composer__design-system-swatches" aria-hidden>
        {designSystem.swatches.slice(0, 4).map((swatch) => (
          <span
            key={`${designSystem.id}-${swatch}`}
            className="chat-composer__design-system-swatch"
            style={{ backgroundColor: swatch }}
          />
        ))}
      </span>
      {selected ? <CheckIcon size={14} aria-hidden /> : null}
    </button>
  );
}
