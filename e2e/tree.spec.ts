import { test, expect } from '@playwright/test'
import { loadExample } from './helpers'

test.describe('Tree editor', () => {
  test('adding a key not defined in the schema shows the "not in schema" badge; undo removes it', async ({
    page,
  }) => {
    await loadExample(page)
    await page.locator('#mode-tree-btn').click()

    const tree = page.locator('#tree-host')
    await expect(tree).toBeVisible()
    const badge = page.locator('.jt-schema-ext')
    // every key in the demo is schema-covered, so no external badge to start
    await expect(badge).toHaveCount(0)

    // add a brand-new key (keys live in <input> values); it isn't in the schema
    const addKey = tree.locator('.jt-add input.jt-key').first()
    await addKey.fill('customFlag')
    await addKey.press('Enter')

    await expect(badge).toHaveText('not in schema')

    await page.locator('#undo').click()
    await expect(badge).toHaveCount(0)
  })

  test('type chips label each value type', async ({ page }) => {
    await loadExample(page)
    await page.locator('#mode-tree-btn').click()

    // every leaf/among the rows carries a color-coded type chip
    const chips = page.locator('.jt-type-chip')
    await expect(chips.first()).toBeVisible()
    // string field "name" -> string chip somewhere in the tree
    await expect(page.locator('.jt-type-chip[data-type="string"]').first()).toBeVisible()
    await expect(page.locator('.jt-type-chip[data-type="boolean"]').first()).toBeVisible()
  })

  test('loading populates the Tree immediately, without a mode/tab round-trip', async ({
    page,
  }) => {
    // Regression: load only rebuilt the hidden Block form, so the visible Tree
    // (the default view) stayed stale until the user switched tabs/modes. Note
    // there is deliberately NO #mode-tree-btn click here — the Tree must be
    // populated the instant the example loads.
    await loadExample(page)

    const tree = page.locator('#tree-host')
    await expect(tree).toBeVisible()
    await expect(tree.locator('.jt-row').first()).toBeVisible()
    // the demo's "name" key is present as an editable key input
    await expect(tree.locator('input.jt-key').first()).toHaveValue('name')
  })
})
