// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HexColorPopover } from './HexColorPopover';

vi.mock('react-colorful', () => ({
  HexColorPicker: ({ color, onChange }: { color: string; onChange: (value: string) => void }) => (
    <button type="button" aria-label="Mock react-colorful picker" data-color={color} onClick={() => onChange('#123456')}>
      Pick mock color
    </button>
  ),
}));

describe('HexColorPopover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a react-colorful picker without rendering a native color input', () => {
    render(<HexColorPopover label="Accent" value="#abcdef" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pick Accent' }));

    expect(screen.getByRole('dialog', { name: 'Accent color picker' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mock react-colorful picker' }).getAttribute('data-color')).toBe('#abcdef');
    expect(document.querySelector('input[type="color"]')).toBeNull();
  });

  it('emits hex values selected from react-colorful', () => {
    const onChange = vi.fn();
    render(<HexColorPopover label="Accent" value="#abcdef" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pick Accent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mock react-colorful picker' }));

    expect(onChange).toHaveBeenCalledWith('#123456');
  });

  it('positions the picker above the swatch when there is not enough viewport space below', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(224);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(224);

    render(<HexColorPopover label="Accent" value="#abcdef" onChange={vi.fn()} />);

    const swatchButton = screen.getByRole('button', { name: 'Pick Accent' });
    swatchButton.getBoundingClientRect = vi.fn(() => ({
      bottom: 592,
      height: 32,
      left: 20,
      right: 68,
      top: 560,
      width: 48,
      x: 20,
      y: 560,
      toJSON: () => ({}),
    }));

    fireEvent.click(swatchButton);

    const picker = screen.getByRole('dialog', { name: 'Accent color picker' });
    expect(Number.parseInt(picker.style.top, 10)).toBeLessThan(560);
    expect(Number.parseInt(picker.style.top, 10)).toBeGreaterThanOrEqual(12);
  });
});
