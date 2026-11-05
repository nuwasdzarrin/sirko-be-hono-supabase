import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifyAdmin, setNotifyTransport, sentNotices, tgEsc, type AdminNotice } from '../../src/lib/notify.js';

/**
 * notifyAdmin() — notifikasi admin via Telegram, dipakai bersama PPOB & Juragan.
 * Kontrak: tak pernah melempar (gagal kirim tak boleh menggagalkan transaksi bisnis),
 * transport bisa diganti di test, tanpa TELEGRAM_* → dilewati (log saja).
 */
describe('notifyAdmin', () => {
  let restore: () => void = () => {};
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('memakai transport yang dipasang & mencatat jejak', async () => {
    const got: AdminNotice[] = [];
    restore = setNotifyTransport(async (n) => {
      got.push(n);
    });
    await notifyAdmin({ text: '<b>Halo</b>', linkPath: '/dashboard', linkLabel: 'Buka' });
    expect(got).toEqual([{ text: '<b>Halo</b>', linkPath: '/dashboard', linkLabel: 'Buka' }]);
    expect(sentNotices.at(-1)?.text).toBe('<b>Halo</b>');
  });

  it('transport gagal → tidak melempar, hanya log error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    restore = setNotifyTransport(async () => {
      throw new Error('Telegram down');
    });
    await expect(notifyAdmin({ text: 'x' })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });

  it('tanpa TELEGRAM_BOT_TOKEN/CHAT_ID → dilewati tanpa panggilan jaringan', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await notifyAdmin({ text: '<i>uji</i> tanpa konfigurasi' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).toContain('uji tanpa konfigurasi');
  });

  it('jejak dibatasi 50 entri terakhir', async () => {
    restore = setNotifyTransport(async () => {});
    for (let i = 0; i < 60; i++) await notifyAdmin({ text: `n${i}` });
    expect(sentNotices.length).toBeLessThanOrEqual(50);
    expect(sentNotices.at(-1)?.text).toBe('n59');
  });

  it('tgEsc meng-escape karakter HTML Telegram', () => {
    expect(tgEsc('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    expect(tgEsc(null)).toBe('');
  });
});
