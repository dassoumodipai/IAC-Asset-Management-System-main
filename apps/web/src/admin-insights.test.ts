import { describe, expect, it } from 'vitest';
import { barPercent, formatInr, fyOptions, humaniseAction } from './admin-insights';

describe('admin insight helpers', () => {
  it('formats Indian rupees without decimals', () => expect(formatInr(100000)).toBe('₹1,00,000'));
  it('starts financial year in April', () => {
    expect(fyOptions(new Date('2026-10-23'))[0]).toEqual({ value: '2026', label: 'FY 2026-27' });
    expect(fyOptions(new Date('2026-02-23'))[0]).toEqual({ value: '2025', label: 'FY 2025-26' });
  });
  it('humanises audit action names', () =>
    expect(humaniseAction('TICKET_CREATED')).toBe('Ticket created'));
  it('limits bar width to the chart range', () => {
    expect(barPercent(3, 4)).toBe(75);
    expect(barPercent(5, 4)).toBe(100);
    expect(barPercent(1, 0)).toBe(0);
  });
});
