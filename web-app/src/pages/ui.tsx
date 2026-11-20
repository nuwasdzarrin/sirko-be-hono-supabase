import { onCleanup, onMount, Show, type JSX, type ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { num, parseRp } from '../pos/calc';

/** Dialog modal: Esc / klik latar = tutup. */
export function Modal(props: ParentProps<{ title: string; onClose: () => void; wide?: boolean; footer?: JSX.Element }>) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      props.onClose();
    }
  };
  onMount(() => document.addEventListener('keydown', onKey, true));
  onCleanup(() => document.removeEventListener('keydown', onKey, true));
  return (
    <Portal>
      <div class="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
          <div class="modal-head">
            <h2>{props.title}</h2>
            <button class="x" aria-label="Tutup" onClick={() => props.onClose()}>×</button>
          </div>
          <div class="modal-body">{props.children}</div>
          <Show when={props.footer}><div class="modal-foot">{props.footer}</div></Show>
        </div>
      </div>
    </Portal>
  );
}

/** Input rupiah: tampil "12.500", nilai integer. */
export function MoneyInput(props: { value: number; onInput: (n: number) => void; id?: string; autofocus?: boolean; placeholder?: string; ref?: (el: HTMLInputElement) => void; class?: string }) {
  return (
    <input
      id={props.id}
      ref={props.ref}
      class={props.class}
      inputmode="numeric"
      autocomplete="off"
      autofocus={props.autofocus}
      placeholder={props.placeholder ?? '0'}
      value={props.value ? num(props.value) : ''}
      onInput={(e) => {
        const n = parseRp(e.currentTarget.value);
        const el = e.currentTarget;
        props.onInput(n);
        el.value = n ? num(n) : '';
      }}
      onFocus={(e) => e.currentTarget.select()}
    />
  );
}

export function Toast(props: { msg: string; kind?: 'ok' | 'err' | 'warn' }) {
  return (
    <Show when={props.msg}>
      <div class={`toast ${props.kind ?? 'ok'}`} role="status">{props.msg}</div>
    </Show>
  );
}
