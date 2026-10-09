import { type Browser, chromium, type Frame, type Page } from 'playwright';
import type { Context } from '../domain/model';
import { assertContextText } from './read';
export const BASE_URL = 'https://export.impexcube.in/';
export interface BrowserConfig {
  username: string;
  password: string;
  context: Context;
  headed?: boolean;
  executablePath?: string;
}
export interface BrowserSession {
  page: Page;
  context: Context;
  browser?: Browser;
}
export async function postback(
  s: BrowserSession,
  action: () => Promise<unknown>,
  frame: Frame = s.page.mainFrame(),
): Promise<void> {
  const expectedFrame = frame;
  let committed = false;
  let resolveCommit: () => void = () => {};
  const commit = new Promise<void>((resolve) => {
    resolveCommit = resolve;
  });
  const onFrame = (frame: import('playwright').Frame) => {
    if (frame === expectedFrame) {
      committed = true;
      resolveCommit();
    }
  };
  s.page.on('framenavigated', onFrame);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = s.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().startsWith(BASE_URL) &&
        r.request().frame() === expectedFrame,
      { timeout: 20000 },
    );
    const [r] = await Promise.all([response, action()]);
    if (!r.ok()) throw new Error('Site postback failed');
    await r.finished();
    if (r.request().isNavigationRequest() && !committed)
      await Promise.race([
        commit,
        new Promise<void>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Postback navigation did not commit')),
            20000,
          );
        }),
      ]);
    await expectedFrame.waitForLoadState('domcontentloaded');
    await expectedFrame.waitForFunction(() => {
      const sys = (window as any).Sys;
      return !sys?.WebForms?.PageRequestManager?.getInstance()?.get_isInAsyncPostBack();
    });
  } finally {
    s.page.off('framenavigated', onFrame);
    if (timer) clearTimeout(timer);
  }
}
export async function openSession(
  config: BrowserConfig,
): Promise<BrowserSession> {
  if (!config.username || !config.password)
    throw new Error('Set IMPEX_USERNAME and IMPEX_PASSWORD at runtime');
  const browser = await chromium.launch({
    headless: !config.headed,
    executablePath:
      config.executablePath ??
      process.env.IMPEX_BROWSER_EXECUTABLE ??
      '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const s: BrowserSession = { page, context: config.context, browser };
    await page.goto(BASE_URL + 'frmLogin.aspx');
    await page.locator('#txtUser').fill(config.username);
    await page.locator('#txtPassword').fill(config.password);
    await postback(s, () => page.locator('#BtnSubmit').click());
    await continueLogin(s);
    await selectSessionOption(s, '#drCompany', 'VISHAL LOGISTICS SOLUTIONS');
    await selectSessionOption(s, '#drBranch', config.context.branch);
    await selectSessionOption(s, '#drFinancial', config.context.financialYear);
    await postback(s, () =>
      page.getByRole('button', { name: 'GO', exact: true }).click(),
    );
    await assertSession(s);
    return s;
  } catch (e) {
    await browser.close();
    const detail = (e instanceof Error ? e.message : 'Unknown error')
      .replaceAll(config.password, '[redacted]')
      .replaceAll(config.username, '[redacted]');
    throw new Error('Sign-in failed: ' + detail);
  }
}
export async function assertSession(
  s: BrowserSession,
  jobNo?: string,
): Promise<void> {
  if (!s.page.url().startsWith(BASE_URL))
    throw new Error('Unexpected browser destination');
  const snapshot = await s.page.locator('body').evaluate((body) => ({
    text: (body as HTMLElement).innerText,
    jobs: ['ContentPlaceHolder1_txtjno', 'ContentPlaceHolder1_txtJobNo'].map(
      (id) => (document.getElementById(id) as HTMLInputElement | null)?.value,
    ),
  }));
  assertContextText(snapshot.text, s.context);
  if (jobNo && !snapshot.jobs.includes(jobNo))
    throw new Error('Target job context mismatch');
}
export async function ensureContext(
  s: BrowserSession,
  context: Context,
): Promise<void> {
  try {
    assertContextText(await s.page.locator('body').innerText(), context);
    s.context = context;
    return;
  } catch {}
  await s.page.locator('#btnBranch').click();
  await s.page
    .getByRole('combobox', { name: 'Please Select Branch', exact: true })
    .waitFor();
  const branchControl = s.page.getByRole('combobox', {
    name: 'Please Select Branch',
    exact: true,
  });
  await selectSessionControl(s, branchControl, context.branch);
  // Financial-year selector was observed on the branch-switch form; identify it by its year options.
  const years = s.page.locator('select').filter({
    has: s.page.locator('option').filter({ hasText: context.financialYear }),
  });
  if ((await years.count()) !== 1)
    throw new Error('Financial-year selector ambiguous');
  await selectSessionControl(s, years, context.financialYear);
  await postback(s, () =>
    s.page.getByRole('button', { name: 'GO', exact: true }).click(),
  );
  s.context = context;
  await assertSession(s);
}

export async function continueLogin(s: BrowserSession): Promise<void> {
  await s.page.waitForFunction(
    () =>
      !!document.querySelector('#drBranch') ||
      !!document.querySelector('#btnresubmit'),
  );
  if ((await s.page.locator('#drBranch').count()) === 0)
    await postback(s, () => s.page.locator('#btnresubmit').click());
  await s.page.locator('#drBranch').waitFor({ state: 'visible' });
}

export async function selectSessionOption(
  s: BrowserSession,
  selector: string,
  label: string,
) {
  return selectSessionControl(s, s.page.locator(selector), label);
}
export async function selectSessionControl(
  s: BrowserSession,
  control: import('playwright').Locator,
  label: string,
) {
  const selected = await control.locator('option:checked').textContent();
  if (selected?.trim() === label) return;
  const action = () => control.selectOption({ label });
  if ((await control.getAttribute('onchange'))?.includes('__doPostBack'))
    await postback(s, action);
  else await action();
}
