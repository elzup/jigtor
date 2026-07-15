import { test, expect } from '@playwright/test'
import { loadExample } from './helpers'

test.describe('Block form editing', () => {
  test('editing a field updates the live diff and the pending-change count', async ({ page }) => {
    await loadExample(page)
    await page.locator('#mode-block-btn').click()

    const name = page.locator('input[data-path="name"]')
    await expect(name).toBeVisible()
    await expect(name).toHaveValue('abc123')

    await name.fill('xyz789')
    await name.blur()

    // whole-file live diff reflects the edit immediately
    await expect(page.locator('#config-preview')).toContainText('xyz789')
    // save button surfaces the pending-change count
    await expect(page.locator('#save')).toContainText('(1)')
  })

  test('compact toggle reflows the form without losing values', async ({ page }) => {
    await loadExample(page)
    await page.locator('#mode-block-btn').click()

    await page.locator('#compact-mode').check()
    await expect(page.locator('#form-host')).toHaveClass(/compact/)
    await expect(page.locator('input[data-path="name"]')).toHaveValue('abc123')
  })
})
