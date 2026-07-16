import { test, expect } from '@playwright/test'
import { loadExample } from './helpers'

// Exploratory smoke test: boots the real app and opens a project folder the way
// a user would (the single entry point), so we can see the shell actually render.
test('app boots and opening a project populates the editor', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'jigtor' })).toBeVisible()

  // Folder-open is the only entry; the example project auto-connects.
  await loadExample(page)

  // The example's fields should be reachable in the live diff.
  await expect(page.locator('#config-preview')).toContainText('abc123')
})
