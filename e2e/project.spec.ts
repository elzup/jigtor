import { test, expect } from '@playwright/test'
import { installFakeProject } from './fakeFs'

test.describe('Project folder + explorer config selection', () => {
  test('opening a multi-JSON folder defers the choice to the explorer, then connects', async ({ page }) => {
    await installFakeProject(page)
    await page.goto('/')

    await page.locator('#open-project').click()

    // Multiple candidates → explorer lists them, none selected yet (all "pick").
    const tree = page.locator('#project-tree')
    await expect(tree).toBeVisible()
    await expect(tree.locator('.tree-file', { hasText: 'config.json' })).toBeVisible()
    await expect(tree.locator('.tree-file', { hasText: 'alt.json' })).toBeVisible()
    await expect(tree.locator('.tree-badge', { hasText: 'pick' })).toHaveCount(2)

    // Pick config.json in the explorer → it connects and is badged "editing".
    await tree.locator('.tree-link', { hasText: 'config.json' }).click()
    await expect(
      tree.locator('.tree-file.active', { hasText: 'config.json' }).locator('.tree-badge'),
    ).toHaveText('editing')
    // the on-disk config is now loaded (visible in the live diff)
    await expect(page.locator('#config-preview')).toContainText('from-disk')

    // Switch to the sibling candidate from the explorer.
    await tree.locator('.tree-link', { hasText: 'alt.json' }).click()
    await expect(
      tree.locator('.tree-file.active', { hasText: 'alt.json' }).locator('.tree-badge'),
    ).toHaveText('editing')
  })
})
