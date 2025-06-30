import type { Page, TestInfo } from '@playwright/test';
import { test } from '@playwright/test';

/**
 * Takes a screenshot and saves it to the test artifacts directory
 * @param page - The page to screenshot
 * @param name - The screenshot name (without extension)
 * @param testInfo - Optional test info, will use current test if not provided
 */
export async function takeDebugScreenshot(
  page: Page,
  name: string,
  testInfo?: TestInfo
): Promise<string> {
  const info = testInfo || test.info();
  const fileName = `${name}.png`;

  // Attach screenshot to test report
  const screenshot = await page.screenshot();
  await info.attach(fileName, {
    body: screenshot,
    contentType: 'image/png',
  });

  // Also save to file for local debugging
  const filePath = info.outputPath(fileName);
  await page.screenshot({ path: filePath });

  return filePath;
}

/**
 * Takes a screenshot on error/failure
 * @param page - The page to screenshot
 * @param error - The error that occurred
 * @param context - Additional context for the screenshot name
 */
export async function screenshotOnError(page: Page, error: Error, context: string): Promise<void> {
  try {
    const timestamp = Date.now();
    const sanitizedContext = context.replace(/[^a-zA-Z0-9-_]/g, '-');
    const name = `error-${sanitizedContext}-${timestamp}`;

    await takeDebugScreenshot(page, name);
    console.log(`Screenshot saved for error in ${context}: ${error.message}`);
  } catch (screenshotError) {
    console.error('Failed to take error screenshot:', screenshotError);
  }
}
