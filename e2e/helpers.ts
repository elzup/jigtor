import type { Page } from '@playwright/test'

// Boot the app with the bundled demo (schema + config) loaded — the fastest way
// into a fully-populated editor without needing the native folder picker.
export async function loadExample(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByText('Other sources').click()
  await page.getByRole('button', { name: 'Load example' }).click()
}
