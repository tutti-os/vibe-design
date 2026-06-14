import React from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker as ReactColorfulHexPicker } from 'react-colorful';
import { cn } from '@tutti-os/ui-system/utils';

export interface HexColorPopoverProps {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}

const PICKER_GAP = 8;
const VIEWPORT_EDGE_GAP = 12;
const PICKER_FALLBACK_SIZE = 224;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function HexColorPopover({ className, label, onChange, value }: HexColorPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties>({
    left: 0,
    position: 'fixed',
    top: 0,
    visibility: 'hidden',
  });
  const pickerValue = normalizePickerHex(value);
  const pickerLabel = label.toLowerCase().includes('color') ? `${label} picker` : `${label} color picker`;

  React.useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Node && popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;

    function updatePopoverPosition() {
      const trigger = rootRef.current;
      if (!trigger) return;

      const triggerRect = trigger.getBoundingClientRect();
      const popoverWidth = popoverRef.current?.offsetWidth || PICKER_FALLBACK_SIZE;
      const popoverHeight = popoverRef.current?.offsetHeight || PICKER_FALLBACK_SIZE;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const belowTop = triggerRect.bottom + PICKER_GAP;
      const aboveTop = triggerRect.top - popoverHeight - PICKER_GAP;
      const fitsBelow = belowTop + popoverHeight <= viewportHeight - VIEWPORT_EDGE_GAP;
      const top = fitsBelow || aboveTop < VIEWPORT_EDGE_GAP
        ? Math.max(VIEWPORT_EDGE_GAP, Math.min(belowTop, viewportHeight - popoverHeight - VIEWPORT_EDGE_GAP))
        : aboveTop;
      const left = Math.max(
        VIEWPORT_EDGE_GAP,
        Math.min(triggerRect.left, viewportWidth - popoverWidth - VIEWPORT_EDGE_GAP),
      );

      setPopoverStyle({
        left,
        position: 'fixed',
        top,
        visibility: 'visible',
        zIndex: 50,
      });
    }

    updatePopoverPosition();
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);

    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open]);

  const picker = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={pickerLabel}
          className="rounded-lg border border-border-1 bg-background-panel p-3 shadow-panel"
          style={popoverStyle}
        >
          <ReactColorfulHexPicker color={pickerValue} onChange={onChange} />
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Pick ${label}`}
        aria-expanded={open}
        className={cn(
          'relative h-8 w-12 overflow-hidden rounded-md border border-border-1 bg-background-fronted shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
          className,
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" className="absolute inset-0" style={{ backgroundColor: pickerValue }} />
      </button>
      {picker}
    </div>
  );
}

function normalizePickerHex(value: string): string {
  const trimmedValue = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmedValue)) {
    return trimmedValue;
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmedValue)) {
    return `#${trimmedValue
      .slice(1)
      .split('')
      .map((part) => `${part}${part}`)
      .join('')}`;
  }
  return '#000000';
}
