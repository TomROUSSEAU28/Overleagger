import { useLayoutEffect, useRef, type RefObject } from 'react';
import { toggleDollars, type Edit } from './mathEdit';

export type Field = HTMLTextAreaElement | HTMLInputElement;

/**
 * Apply an edit to a text field: the new value goes through `onChange`, and the selection is set
 * as soon as React has written the new value (before any next key press lands).
 */
export function useApply(input: RefObject<Field | null>, onChange: (v: string) => void) {
  const pending = useRef<Edit | null>(null);
  useLayoutEffect(() => {
    const e = pending.current;
    const el = input.current;
    if (!e || !el || el.value !== e.value) return;
    pending.current = null;
    el.focus();
    el.setSelectionRange(e.start, e.end);
  });
  return (make: (value: string, start: number, end: number) => Edit) => {
    const el = input.current;
    if (!el) return;
    const len = el.value.length;
    const e = make(el.value, el.selectionStart ?? len, el.selectionEnd ?? len);
    pending.current = e;
    onChange(e.value);
  };
}

/** Wraps / unwraps the selection (or the line) in `$…$`: for a Ctrl+M shortcut. */
export function useToggleDollars(input: RefObject<Field | null>, onChange: (v: string) => void) {
  const apply = useApply(input, onChange);
  return () => apply(toggleDollars);
}
