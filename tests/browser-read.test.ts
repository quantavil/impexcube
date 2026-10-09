import { expect, test } from 'bun:test';
import { assertContextText, parseJobRows } from '../src/browser/read';

const ctx: any = { branch: 'DELHI', financialYear: '2026-2027' };
test('session expiry and wrong year/branch stop discovery', () => {
  expect(() => assertContextText('Login User Name Password', ctx)).toThrow();
  expect(() =>
    assertContextText(
      'VISHAL LOGISTICS SOLUTIONS Branch : MORADABAD Fin.Year :2026-2027',
      ctx,
    ),
  ).toThrow();
  expect(() =>
    assertContextText(
      'VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2025-2026',
      ctx,
    ),
  ).toThrow();
});
test('visible job cells are parsed without assuming first row is eligible', () => {
  expect(
    parseJobRows([
      [
        'Select',
        '1',
        'VIDE-EXP-2627-111',
        '27/07/2026',
        'CANCELLED',
        'ICD',
        'ACME',
        '0',
      ],
      [
        'Select',
        '2',
        'VIDE-EXP-2627-110',
        '16/07/2026',
        'REF',
        'TKD',
        'ACME',
        '5077407',
      ],
    ]),
  ).toEqual([
    { jobNo: 'VIDE-EXP-2627-111', jobDate: '27/07/2026', cancelled: true },
    { jobNo: 'VIDE-EXP-2627-110', jobDate: '16/07/2026', cancelled: false },
  ]);
});
