# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\app.spec.js >> single file upload should show error
- Location: tests\app.spec.js:32:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('text=CHECK FOR PLAGIARISM')
    - locator resolved to <button disabled class="check-btn">Check for Plagiarism</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not stable
    - retrying click action
      - waiting 100ms
    - waiting for element to be visible, enabled and stable
    - element is not stable
  47 × retrying click action
       - waiting 500ms
       - waiting for element to be visible, enabled and stable
       - element is not enabled
  - retrying click action
    - waiting 500ms

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]: Code Plagiarism Detector
    - generic [ref=e6]:
      - generic [ref=e7]: eklavya47raj@gmail.com
      - button "Sign out" [ref=e8] [cursor=pointer]
  - generic [ref=e9]:
    - generic [ref=e10]:
      - generic [ref=e11]: BUILDING THE FUTURE OF CODE INTEGRITY
      - heading "Check for plagiarism in source code" [level=1] [ref=e12]:
        - text: Check for plagiarism in
        - emphasis [ref=e13]: source code
      - paragraph [ref=e14]: Combines LLaMA 3.3 70B AI analysis with deterministic algorithms — with full algorithmic fallback when AI is unavailable.
      - button "History (5)" [ref=e16] [cursor=pointer]
    - generic [ref=e17]:
      - button "Pair Check" [ref=e18] [cursor=pointer]
      - button "One-to-Many" [ref=e19] [cursor=pointer]
      - button "Batch Matrix" [ref=e20] [cursor=pointer]
    - generic [ref=e21]:
      - generic [ref=e22]:
        - generic [ref=e23] [cursor=pointer]:
          - button "✕" [ref=e24]
          - button "Choose File" [ref=e25]
          - generic [ref=e26]: ✦
          - generic [ref=e27]: File A — Original
          - generic [ref=e28]: sample1.py
          - generic [ref=e30]:
            - generic [ref=e31]: 🐍
            - generic [ref=e32]: Python
        - button "📋 Paste code instead" [ref=e33] [cursor=pointer]
      - generic [ref=e34]:
        - generic [ref=e35] [cursor=pointer]:
          - button "Choose File" [ref=e36]
          - generic [ref=e37]: ↑
          - generic [ref=e38]: File B — Suspect
          - generic [ref=e39]: click or drag & drop
        - button "📋 Paste code instead" [ref=e40] [cursor=pointer]
    - button "Check for Plagiarism" [disabled] [ref=e41]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('full app flow', async ({ page }) => {
  4  |   await page.goto('http://localhost:5173');
  5  | 
  6  |   // LOGIN
  7  |   await page.fill('input[type="email"]', 'eklavya47raj@gmail.com');
  8  |   await page.fill('input[type="password"]', '123456');
  9  |   await page.click('text=Login');
  10 | 
  11 |   // WAIT FOR DASHBOARD
  12 |   await page.waitForSelector('text=Code Plagiarism Detector');
  13 | 
  14 |   // UPLOAD FILES
  15 |   const fileInputs = page.locator('input[type="file"]');
  16 | 
  17 |   await fileInputs.nth(0).setInputFiles('tests/sample1.py');
  18 |   await fileInputs.nth(1).setInputFiles('tests/sample2.py');
  19 | 
  20 |   // CLICK CHECK
  21 |   await page.click('text=CHECK FOR PLAGIARISM');
  22 | 
  23 |   // WAIT FOR RESULT
  24 |   await page.waitForSelector('text=similar');
  25 | 
  26 |   // OPEN HISTORY
  27 |   await page.click('text=History');
  28 | 
  29 |   // VERIFY SOMETHING SHOWS
  30 |   await page.waitForSelector('text=%');
  31 | });
  32 | test('single file upload should show error', async ({ page }) => {
  33 |   await page.goto('http://localhost:5173');
  34 | 
  35 |   await page.fill('input[type="email"]', 'eklavya47raj@gmail.com');
  36 |   await page.fill('input[type="password"]', '123456');
  37 |   await page.click('text=Login');
  38 | 
  39 |   await page.waitForSelector('text=Code Plagiarism Detector');
  40 | 
  41 |   const fileInputs = page.locator('input[type="file"]');
  42 |   await fileInputs.nth(0).setInputFiles('tests/sample1.py');
  43 | 
> 44 |   await page.click('text=CHECK FOR PLAGIARISM');
     |              ^ Error: page.click: Test timeout of 30000ms exceeded.
  45 | 
  46 |   await expect(page.locator('text=upload')).toBeVisible();
  47 | });
```