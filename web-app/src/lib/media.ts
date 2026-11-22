import { createSignal } from 'solid-js';

/**
 * Lebar layar HP (≤ 860px) → tampilan disamakan dengan aplikasi HP (app bar + navigasi bawah,
 * Material 3). Batas sama dengan `@media (max-width: 860px)` di mobile.css.
 */
const MQ = '(max-width: 860px)';
const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MQ) : null;
const [mobile, setMobile] = createSignal(mql?.matches ?? false);
mql?.addEventListener('change', (e) => setMobile(e.matches));

export const isMobile = mobile;
