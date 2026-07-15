import { test, expect } from '@playwright/test'
import { loadExample } from './helpers'

test.describe('Block / Tree mode', () => {
  test('an edit made in Block mode survives a switch to Tree and back', async ({ page }) => {
    await loadExample(page)

    await page.locator('#mode-block-btn').click()
    const name = page.locator('input[data-path="name"]')
    await name.fill('switched')
    await name.blur()

    // Tree view sees the same underlying config (via the always-on live diff)
    await page.locator('#mode-tree-btn').click()
    await expect(page.locator('#config-preview')).toContainText('switched')

    // back to Block, the input still holds the edited value
    await page.locator('#mode-block-btn').click()
    await expect(page.locator('input[data-path="name"]')).toHaveValue('switched')
  })
})
