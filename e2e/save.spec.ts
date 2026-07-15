import { test, expect } from '@playwright/test'
import { openFakeProjectAndPick } from './fakeFs'

test.describe('Save flow', () => {
  test('review dialog summarizes the change (no diff body) and a direct save writes then clears the count', async ({
    page,
  }) => {
    await openFakeProjectAndPick(page)
    await expect(page.locator('#config-preview')).toContainText('from-disk')

    await page.locator('#mode-block-btn').click()
    const name = page.locator('input[data-path="name"]')
    await name.fill('edited-name')
    await name.blur()
    await expect(page.locator('#save')).toContainText('(1)')

    await page.locator('#save').click()
    const dialog = page.locator('#save-dialog')
    await expect(dialog.getByRole('heading', { name: 'Review changes' })).toBeVisible()
    await expect(dialog).toContainText('1 change to save')
    // the whole-file diff was removed from the dialog (lives in the Live diff)
    await expect(dialog.locator('.save-diff')).toHaveCount(0)

    await dialog.getByRole('button', { name: /Save config\.json/ }).click()
    await expect(page.locator('#status')).toContainText('Saved config.json')
    await expect(page.locator('#save')).not.toContainText('(1)')
  })

  test('review dialog reports no changes on a clean config', async ({ page }) => {
    await openFakeProjectAndPick(page)
    await page.locator('#save').click()
    await expect(page.locator('#save-dialog')).toContainText('No changes')
  })
})
