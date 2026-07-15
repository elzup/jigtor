import { test, expect } from '@playwright/test'
import { loadExample } from './helpers'

test.describe('Schema tab', () => {
  test('sample preview reflects the loaded schema', async ({ page }) => {
    await loadExample(page)
    await page.locator('.tab[data-tab="schema"]').click()

    const sample = page.locator('#sample-preview')
    await expect(sample).toBeVisible()
    // a valid sample config built from the schema mentions its fields
    await expect(sample).toContainText('mode')
    await expect(sample).toContainText('retries')
  })

  test('tabs switch the visible panel', async ({ page }) => {
    await loadExample(page)
    await expect(page.locator('#panel-edit')).toBeVisible()

    await page.locator('.tab[data-tab="history"]').click()
    await expect(page.locator('#panel-history')).toBeVisible()
    await expect(page.locator('#panel-edit')).toBeHidden()

    await page.locator('.tab[data-tab="edit"]').click()
    await expect(page.locator('#panel-edit')).toBeVisible()
  })
})
