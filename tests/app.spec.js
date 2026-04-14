import { test, expect } from '@playwright/test';

test('full app flow', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // LOGIN
  await page.fill('input[type="email"]', 'eklavya47raj@gmail.com');
  await page.fill('input[type="password"]', '123456');
  await page.click('text=Login');

  // WAIT FOR DASHBOARD
  await page.waitForSelector('text=Code Plagiarism Detector');

  // UPLOAD FILES
  const fileInputs = page.locator('input[type="file"]');

  await fileInputs.nth(0).setInputFiles('tests/sample1.py');
  await fileInputs.nth(1).setInputFiles('tests/sample2.py');

  // CLICK CHECK
  await page.click('text=CHECK FOR PLAGIARISM');

  // WAIT FOR RESULT
  await page.waitForSelector('text=similar');

  // OPEN HISTORY
  await page.click('text=History');

  // VERIFY SOMETHING SHOWS
  await page.waitForSelector('text=%');
});
test('single file upload should show error', async ({ page }) => {
  await page.goto('http://localhost:5173');

  await page.fill('input[type="email"]', 'eklavya47raj@gmail.com');
  await page.fill('input[type="password"]', '123456');
  await page.click('text=Login');

  await page.waitForSelector('text=Code Plagiarism Detector');

  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles('tests/sample1.py');

  await page.click('text=CHECK FOR PLAGIARISM');

  await expect(page.locator('text=upload')).toBeVisible();
});