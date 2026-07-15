import { test, expect } from '@playwright/test'
import { openFakeProjectAndPick } from './fakeFs'

// Editing a field then saving records a snapshot; the History tab diffs
// consecutive saved versions, so two saves are needed to surface a change.
test.describe('History tab', () => {
  test('a field edited across two saves shows up in History', async ({ page }) => {
    await openFakeProjectAndPick(page)
    await page.locator('#mode-block-btn').click()
    const name = page.locator('input[data-path="name"]')

    const editAndSave = async (value: string): Promise<void> => {
      await name.fill(value)
      await name.blur()
      await page.locator('#save').click()
      await page.locator('#save-dialog').getByRole('button', { name: /Save config\.json/ }).click()
      await expect(page.locator('#status')).toContainText('Saved config.json')
    }

    await editAndSave('v1')
    await editAndSave('v2')

    await page.locator('.tab[data-tab="history"]').click()
    const history = page.locator('#panel-history')
    await expect(history).toBeVisible()
    await expect(history).toContainText('v2')
  })
})
