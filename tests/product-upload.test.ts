import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { BASE_URL } from '../src/browser/session';
import { uploadProductExcel } from '../src/browser/upload';

test('uploadProductExcel navigates, sets job, uploads file, handles dialog and clicks read/save', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-upload-test-'));
  const dummyExcel = join(dir, 'test.xlsx');
  await writeFile(dummyExcel, 'dummy excel content');

  try {
    const page = await browser.newPage();
    const target = 'EXP-2627-560';
    let goClicked = false;
    let readClicked = false;
    let saveClicked = false;
    let uploadedJob = '';

    const header =
      'VISHAL LOGISTICS SOLUTIONS Branch : MORADABAD Fin.Year :2026-2027';

    await page.route(BASE_URL + '**', async (route) => {
      const req = route.request();
      const data = new URLSearchParams(req.postData() ?? '');

      if (req.method() === 'POST') {
        if (data.has('btnsubmit')) {
          goClicked = true;
          uploadedJob = data.get('txtJobNo') ?? '';
        }
        if (data.has('btnRead')) {
          readClicked = true;
        }
        if (data.has('btnSave')) {
          saveClicked = true;
        }
      }

      const body = `
    <html><body>
    ${header}
    <form method="POST">
     <input id="ContentPlaceHolder1_txtJobNo" name="txtJobNo" value="${uploadedJob || target}">
     <input type="submit" id="ContentPlaceHolder1_btnsubmit" name="btnsubmit" value="Go">
     <input type="file" id="ContentPlaceHolder1_FileUpload1" name="FileUpload1">
     <input type="submit" id="ContentPlaceHolder1_btnRead" name="btnRead" value="Read Excel" onclick="return confirm('Do You Want To Save.');">
     ${readClicked ? '<input type="submit" id="ContentPlaceHolder1_btnSave" name="btnSave" value="Save"><span id="ContentPlaceHolder1_lblMessage">Uploaded successfully</span>' : ''}
    </form>
    </body></html>
   `;

      await route.fulfill({ body, contentType: 'text/html' });
    });

    const session: any = {
      page,
      context: { branch: 'MORADABAD', financialYear: '2026-2027' },
    };
    const result = await uploadProductExcel(session, target, dummyExcel);

    expect(result.status).toBe('ok');
    expect(result.jobNo).toBe(target);
    expect(goClicked).toBe(true);
    expect(readClicked).toBe(true);
    expect(saveClicked).toBe(true);
    expect(result.message).toContain('Uploaded successfully');
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);

test('uploadProductExcel throws error when lblMessage reports failure', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-upload-err-'));
  const dummyExcel = join(dir, 'test.xlsx');
  await writeFile(dummyExcel, 'dummy excel content');

  try {
    const page = await browser.newPage();
    const target = 'EXP-2627-561';
    let uploadedJob = '';
    let readClicked = false;

    await page.route(BASE_URL + '**', async (route) => {
      const req = route.request();
      const data = new URLSearchParams(req.postData() ?? '');
      if (req.method() === 'POST') {
        if (data.has('btnsubmit')) uploadedJob = data.get('txtJobNo') ?? '';
        if (data.has('btnRead')) readClicked = true;
      }
      const body = `
    <html><body>
    VISHAL LOGISTICS SOLUTIONS Branch : MORADABAD Fin.Year :2026-2027
    <form method="POST">
     <input id="ContentPlaceHolder1_txtJobNo" name="txtJobNo" value="${uploadedJob || target}">
     <input type="submit" id="ContentPlaceHolder1_btnsubmit" name="btnsubmit" value="Go">
     <input type="file" id="ContentPlaceHolder1_FileUpload1" name="FileUpload1">
     <input type="submit" id="ContentPlaceHolder1_btnRead" name="btnRead" value="Read Excel">
     ${readClicked ? '<span id="ContentPlaceHolder1_lblMessage">Error: Invalid format in column K</span>' : ''}
    </form>
    </body></html>
   `;
      await route.fulfill({ body, contentType: 'text/html' });
    });

    const session: any = {
      page,
      context: { branch: 'MORADABAD', financialYear: '2026-2027' },
    };
    let uploadErr: Error | null = null;
    try {
      await uploadProductExcel(session, target, dummyExcel);
    } catch (e: any) {
      uploadErr = e;
    }
    expect(uploadErr).not.toBeNull();
    expect(uploadErr?.message).toContain(
      'Product Excel read failed: Error: Invalid format',
    );
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);

test('uploadProductExcel throws error when browser dialog reports failure', async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    chromiumSandbox: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'impex-upload-dlg-err-'));
  const dummyExcel = join(dir, 'test.xlsx');
  await writeFile(dummyExcel, 'dummy excel content');

  try {
    const page = await browser.newPage();
    const target = 'EXP-2627-562';
    let uploadedJob = '';

    await page.route(BASE_URL + '**', async (route) => {
      const req = route.request();
      const data = new URLSearchParams(req.postData() ?? '');
      let readClicked = false;
      if (req.method() === 'POST') {
        if (data.has('btnsubmit')) uploadedJob = data.get('txtJobNo') ?? '';
        if (data.has('btnRead')) readClicked = true;
      }
      const body = `
    <html><body>
    VISHAL LOGISTICS SOLUTIONS Branch : MORADABAD Fin.Year :2026-2027
    <form method="POST">
     <input id="ContentPlaceHolder1_txtJobNo" name="txtJobNo" value="${uploadedJob || target}">
     <input type="submit" id="ContentPlaceHolder1_btnsubmit" name="btnsubmit" value="Go">
     <input type="file" id="ContentPlaceHolder1_FileUpload1" name="FileUpload1">
     <input type="submit" id="ContentPlaceHolder1_btnRead" name="btnRead" value="Read Excel">
     ${readClicked ? '<script>alert("Error: Corrupted workbook format");</script>' : ''}
    </form>
    </body></html>
   `;
      await route.fulfill({ body, contentType: 'text/html' });
    });

    const session: any = {
      page,
      context: { branch: 'MORADABAD', financialYear: '2026-2027' },
    };
    let uploadErr: Error | null = null;
    try {
      await uploadProductExcel(session, target, dummyExcel);
    } catch (e: any) {
      uploadErr = e;
    }
    expect(uploadErr).not.toBeNull();
    expect(uploadErr?.message).toContain(
      'Product Excel read dialog error: Error: Corrupted workbook format',
    );
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
