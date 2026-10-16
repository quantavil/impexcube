import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Journal } from '../src/journal';
import { updateExchangeRates } from '../src/website/exchange';
import { BASE_URL } from '../src/website/session';
import { runFixture } from './fixtures';

test('native iframe Update changes only the identified target and clicks once per run even when unchanged and accepts current site rates', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-rate-'));
  try {
    const page = await browser.newPage();
    let updates = 0,
      rate = '94.800000',
      current = '95.250000';
    const target = 'VIDE-EXP-2627-11';
    await page.route(BASE_URL + '**', async (route) => {
      if (route.request().url().includes('efrmExchangeRateDetails.aspx')) {
        if (route.request().method() === 'POST') {
          updates++;
          rate = current;
        }
        await route.fulfill({
          contentType: 'text/html',
          body: `<form method="POST"><input id="txtJobNo" value="${target}"><input id="txtCurencyCode" value="USD"><input id="txtRate" value="${current}"><input id="btnupdate" type="submit" value="Update"></form><table id="gvCurrency"><tr><td><a href="#">Select</a></td><td>${target}</td><td>USD</td><td>Y</td><td>${rate}</td></tr></table>`,
        });
      } else
        await route.fulfill({
          contentType: 'text/html',
          body: `<body>VISHAL LOGISTICS SOLUTIONS Branch : DELHI Fin.Year :2026-2027<form method="POST"><input id="ContentPlaceHolder1_txtjno" value="${target}"><a href="#" onclick="document.querySelector('form').submit();return false">Exchange Rate</a></form><iframe id="ContentPlaceHolder1_tbJobCreation_TabPanelExch_mainiFrame" src="efrmExchangeRateDetails.aspx"></iframe></body>`,
        });
    });
    const session: any = {
      page,
      context: { branch: 'DELHI', financialYear: '2026-2027' },
    };
    const record = runFixture({
      targetJobNo: target,
      state: 'target_identified',
      expectedRates: { USD: '95.2500' },
      patch: {
        issues: [],
        operations: [
          {
            section: 'invoice',
            field: 'invoice.currency',
            invoiceIndex: 0,
            action: 'replace',
            value: 'USD',
            evidence: [],
          },
        ],
      },
    });
    const journal = new Journal(dir);
    await updateExchangeRates(session, record, journal);
    await updateExchangeRates(session, record, journal);
    expect(updates).toBe(2);
    expect(rate).toBe('95.250000');
    current = '96.000000';
    await updateExchangeRates(session, record, journal);
    expect(updates).toBe(3);
    expect(rate).toBe('96.000000');
    expect(record.expectedRates).toEqual({ USD: '96.000000' });
    expect((await journal.load(record.runId)).expectedRates).toEqual(
      record.expectedRates,
    );
    await expect(
      updateExchangeRates(
        session,
        { ...record, targetJobNo: record.sourceJobNo },
        journal,
      ),
    ).rejects.toThrow();
    expect(updates).toBe(3);
    let wrongCurrency: unknown;
    try {
      await updateExchangeRates(
        session,
        {
          ...record,
          patch: {
            issues: [],
            operations: [
              {
                section: 'invoice',
                field: 'invoice.currency',
                invoiceIndex: 0,
                action: 'replace',
                value: 'EUR',
                evidence: [],
              },
            ],
          },
          shipment: {
            ...record.shipment,
            invoices: [
              {
                ...record.shipment.invoices[0]!,
                'invoice.currency': {
                  value: 'EUR',
                  status: 'default',
                  evidence: [],
                },
              },
            ],
          },
        },
        journal,
      );
    } catch (error) {
      wrongCurrency = error;
    }
    expect(String(wrongCurrency)).toContain('currency differs');
    expect(updates).toBe(3);
    const canonical = {
      ...record,
      shipment: {
        ...record.shipment,
        invoices: [
          {
            ...record.shipment.invoices[0]!,
            'invoice.currency': {
              value: 'US DOLLAR',
              status: 'default' as const,
              evidence: [],
            },
          },
        ],
      },
      patch: {
        issues: [],
        operations: [
          {
            section: 'invoice' as const,
            field: 'invoice.currency',
            invoiceIndex: 0,
            action: 'replace' as const,
            value: 'USD',
            evidence: [],
          },
        ],
      },
    };
    await updateExchangeRates(session, canonical, journal);
    expect(updates).toBe(4);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
