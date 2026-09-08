import { describe, it, expect } from 'vitest';
import { money, isMoney, addMoney, MoneyError, MAX_MONEY } from '../../src/lib/money.js';

describe('money', () => {
  it('menerima integer non-negatif', () => {
    expect(money(0)).toBe(0);
    expect(money(15000)).toBe(15000);
    expect(money(MAX_MONEY)).toBe(MAX_MONEY);
  });

  it('menolak float, negatif, NaN, Infinity, non-number', () => {
    expect(() => money(1500.5)).toThrow(MoneyError);
    expect(() => money(-1)).toThrow(MoneyError);
    expect(() => money(NaN)).toThrow(MoneyError);
    expect(() => money(Infinity)).toThrow(MoneyError);
    expect(() => money('15000' as unknown)).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
  });

  it('isMoney sebagai type guard', () => {
    expect(isMoney(100)).toBe(true);
    expect(isMoney(-1)).toBe(false);
    expect(isMoney(1.5)).toBe(false);
    expect(isMoney('1')).toBe(false);
  });

  it('addMoney memvalidasi tiap suku & hasil', () => {
    expect(addMoney(1000, 2000, 500)).toBe(3500);
    expect(() => addMoney(1000, -1)).toThrow(MoneyError);
  });
});
