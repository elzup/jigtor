import type { Page } from '@playwright/test'
import { installExampleProject } from './fakeFs'

// Boot the app with the bundled demo (schema + config) loaded — the fastest way
// into a fully-populated editor. Opens a fake single-config project whose files
// are the bundled example, so "Open project folder" auto-connects (there is no
// longer a "Load example" button; folder-open is the only entry point).
export async function loadExample(page: Page): Promise<void> {
  await installExampleProject(page)
  await page.goto('/')
  await page.locator('#open-project').click()
}
