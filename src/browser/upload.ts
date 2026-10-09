import type { BrowserSession } from './session';
import { assertSession, BASE_URL, postback } from './session';

export interface ProductUploadResult {
  status: 'ok' | 'error';
  jobNo: string;
  message?: string;
}

export async function uploadProductExcel(
  s: BrowserSession,
  targetJobNo: string,
  excelPath: string,
): Promise<ProductUploadResult> {
  await s.page.goto(BASE_URL + 'frmCSVFileUpload.aspx');
  await assertSession(s);

  await s.page.locator('#ContentPlaceHolder1_txtJobNo').fill(targetJobNo);
  await postback(s, () =>
    s.page.locator('#ContentPlaceHolder1_btnsubmit').click(),
  );
  await assertSession(s, targetJobNo);

  const fileInput = s.page.locator('#ContentPlaceHolder1_FileUpload1');
  if ((await fileInput.count()) === 0) {
    throw new Error(
      'File upload control #ContentPlaceHolder1_FileUpload1 not found on page',
    );
  }

  await fileInput.setInputFiles(excelPath);

  const dialogMessages: string[] = [];
  const handleDialog = async (dialog: import('playwright').Dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  };
  s.page.on('dialog', handleDialog);

  try {
    await postback(s, () =>
      s.page.locator('#ContentPlaceHolder1_btnRead').click(),
    );
    await assertSession(s, targetJobNo);

    const readDialogErr = dialogMessages.find((m) =>
      /error|failed|failure|invalid|exception/i.test(m),
    );
    if (readDialogErr) {
      throw new Error(`Product Excel read dialog error: ${readDialogErr}`);
    }

    const readMessages = await s.page
      .locator(
        '#ContentPlaceHolder1_lblMessage, #lblMessage, #ContentPlaceHolder1_lblResult',
      )
      .allTextContents();
    const readMsg = readMessages
      .map((m) => m.trim())
      .filter(Boolean)
      .join(' ');
    if (/error|failed|failure|invalid|exception/i.test(readMsg)) {
      throw new Error(`Product Excel read failed: ${readMsg}`);
    }

    const saveBtn = s.page
      .locator(
        '#ContentPlaceHolder1_btnSave, #ContentPlaceHolder1_btnUpdate, input[value="Save"], input[value="SAVE"], input[value="Submit Excel Data"]',
      )
      .first();
    if ((await saveBtn.count()) > 0 && (await saveBtn.isVisible())) {
      await postback(s, () => saveBtn.click());
      await assertSession(s, targetJobNo);
    }

    const saveDialogErr = dialogMessages.find((m) =>
      /error|failed|failure|invalid|exception|not saved/i.test(m),
    );
    if (saveDialogErr) {
      throw new Error(`Product Excel upload dialog error: ${saveDialogErr}`);
    }

    const messages = await s.page
      .locator(
        '#ContentPlaceHolder1_lblMessage, #lblMessage, #ContentPlaceHolder1_lblResult',
      )
      .allTextContents();
    const cleanMsg = messages
      .map((m) => m.trim())
      .filter(Boolean)
      .join(' ');
    if (/error|failed|failure|invalid|exception|not saved/i.test(cleanMsg)) {
      throw new Error(`Product Excel upload failed: ${cleanMsg}`);
    }

    return { status: 'ok', jobNo: targetJobNo, message: cleanMsg || undefined };
  } finally {
    s.page.off('dialog', handleDialog);
  }
}
