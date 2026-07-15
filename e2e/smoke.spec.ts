import { test, expect } from '@playwright/test'

// Exploratory smoke test: boots the real app and drives "Load example" the way a
// user would, so we can see what the shell actually renders before writing the
// behavioural specs.
test('app boots and Load example populates the editor', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'jigtor' })).toBeVisible()

  // "Load example" lives under the collapsed "Other sources" details.
  await page.getByText('Other sources').click()
  await page.getByRole('button', { name: 'Load example' }).click()

  // Whatever the default view is, the example's fields should be reachable.
  await expect(page.locator('#config-preview')).toContainText('abc123')
})
