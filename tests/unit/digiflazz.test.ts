import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  sign,
  mapStatus,
  verifyWebhookSignature,
  normalizePhone,
  detectOperator,
  brandKey,
} from '../../src/ppob/digiflazz.js';
import { inCutoff, sellPriceFor, cutoffOf, DEFAULT_PPOB_CONFIG } from '../../src/services/ppob.service.js';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

describe('Digiflazz — tanda tangan & status (dokumentasi resmi)', () => {
  it('sign = md5(username + apiKey + suffix)', () => {
    expect(sign('depo')).toBe(md5('test-df-user' + 'test-df-key' + 'depo'));
    expect(sign('pricelist')).toBe(md5('test-df-usertest-df-keypricelist'));
    expect(sign('ref-123')).toBe(md5('test-df-usertest-df-keyref-123'));
  });

  it('pemetaan status: field status, RC 03/99 selalu pending', () => {
    expect(mapStatus({ status: 'Sukses', rc: '00' })).toBe('success');
    expect(mapStatus({ status: 'Gagal', rc: '02' })).toBe('failed');
    expect(mapStatus({ status: 'Pending', rc: '03' })).toBe('pending');
    expect(mapStatus({ status: 'Gagal', rc: '99' })).toBe('pending'); // router issue ≠ gagal
    expect(mapStatus({ status: 'Gagal', rc: '03' })).toBe('pending');
  });

  it('webhook: HMAC-SHA1 body mentah, constant-time, tolak tanpa secret/prefix', () => {
    const body = '{"data":{"ref_id":"x","status":"Sukses"}}';
    const good = 'sha1=' + createHmac('sha1', 's3cret').update(body).digest('hex');
    expect(verifyWebhookSignature(body, good, 's3cret')).toBe(true);
    expect(verifyWebhookSignature(body + ' ', good, 's3cret')).toBe(false);
    expect(verifyWebhookSignature(body, good.replace('sha1=', ''), 's3cret')).toBe(false);
    expect(verifyWebhookSignature(body, good, undefined)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha1=abc', 's3cret')).toBe(false);
  });
});

describe('Nomor HP & operator', () => {
  it('normalisasi +62/62/spasi/strip → 08…; tolak yang bukan nomor HP', () => {
    expect(normalizePhone('+62 812-3456-7890')).toBe('081234567890');
    expect(normalizePhone('6281234567890')).toBe('081234567890');
    expect(normalizePhone('0812345')).toBeNull();
    expect(normalizePhone('021555666')).toBeNull();
  });

  it('deteksi operator dari prefix', () => {
    expect(detectOperator('081234567890')).toBe('TELKOMSEL');
    expect(detectOperator('085712345678')).toBe('INDOSAT');
    expect(detectOperator('087812345678')).toBe('XL');
    expect(detectOperator('083112345678')).toBe('AXIS');
    expect(detectOperator('089612345678')).toBe('TRI');
    expect(detectOperator('088112345678')).toBe('SMARTFREN');
    expect(detectOperator('085112345678')).toBe('BY.U');
    expect(detectOperator('080012345678')).toBeNull();
    expect(brandKey('Tri')).toBe('TRI');
    expect(brandKey(' xl ')).toBe('XL');
  });
});

describe('Harga & cut-off', () => {
  it('harga jual = modal + markup, dibulatkan ke atas', () => {
    expect(sellPriceFor(10_150, 'pulsa', DEFAULT_PPOB_CONFIG)).toBe(10_700);
    expect(sellPriceFor(10_000, 'data', DEFAULT_PPOB_CONFIG)).toBe(10_500);
    expect(sellPriceFor(20_000, 'pln', DEFAULT_PPOB_CONFIG)).toBe(21_500);
  });

  it('cut-off Digiflazz: "0:0"–"0:0" = tanpa cut-off; dinormalisasi hh:mm', () => {
    expect(cutoffOf('0:0', '0:0')).toEqual({ cutoff_start: null, cutoff_end: null });
    expect(cutoffOf('23:45', '0:15')).toEqual({ cutoff_start: '23:45', cutoff_end: '00:15' });
    expect(cutoffOf(undefined, '1:0')).toEqual({ cutoff_start: null, cutoff_end: null });
  });

  it('cut-off WIB termasuk melewati tengah malam', () => {
    const at = (hm: string) => Date.parse(`2026-11-05T${hm}:00+07:00`);
    expect(inCutoff('23:45', '00:15', at('23:50'))).toBe(true);
    expect(inCutoff('23:45', '00:15', at('00:10'))).toBe(true);
    expect(inCutoff('23:45', '00:15', at('12:00'))).toBe(false);
    expect(inCutoff('01:00', '02:00', at('01:30'))).toBe(true);
    expect(inCutoff(null, null, at('01:30'))).toBe(false);
  });
});
