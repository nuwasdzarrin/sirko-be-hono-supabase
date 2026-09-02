import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  posFor,
  ZERO_TS,
  ZERO_ID,
  type CursorState,
} from '../../src/lib/cursor.ts';
import { AppError } from '../../src/lib/errors.ts';

describe('cursor', () => {
  it('encode → decode round-trip mempertahankan posisi', () => {
    const state: CursorState = {
      products: { ts: '1788271889478019', id: 'aa11bb22-cc33-dd44-ee55-ff6677889900' },
      transactions: { ts: '1788271889999999', id: 'bb11bb22-cc33-dd44-ee55-ff6677889900' },
    };
    const decoded = decodeCursor(encodeCursor(state));
    expect(decoded).toEqual(state);
  });

  it('cursor kosong/undefined → state kosong', () => {
    expect(decodeCursor(undefined)).toEqual({});
    expect(decodeCursor(null)).toEqual({});
  });

  it('posFor mengembalikan posisi awal bila tabel belum ada', () => {
    expect(posFor({}, 'products')).toEqual({ ts: ZERO_TS, id: ZERO_ID });
    expect(ZERO_TS).toBe('0'); // mikrodetik awal, bukan teks timestamptz
  });

  it('mengabaikan tabel tak dikenal saat decode', () => {
    const raw = Buffer.from(
      JSON.stringify({ t: { tabel_hantu: { ts: '1', id: ZERO_ID }, products: { ts: '5', id: ZERO_ID } } }),
      'utf8',
    ).toString('base64');
    const decoded = decodeCursor(raw);
    expect(decoded.tabel_hantu).toBeUndefined();
    expect(decoded.products).toEqual({ ts: '5', id: ZERO_ID });
  });

  it('cursor rusak → AppError VALIDATION', () => {
    expect(() => decodeCursor('%%%bukan-base64-json%%%')).toThrow(AppError);
    const badShape = Buffer.from(JSON.stringify({ t: { products: { ts: 5 } } }), 'utf8').toString('base64');
    expect(() => decodeCursor(badShape)).toThrow(AppError);
  });
});
