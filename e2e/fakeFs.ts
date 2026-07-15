import type { Page } from '@playwright/test'

// Install an in-memory File System Access directory so the project-folder flows
// (open → pick config in the explorer → switch → save) can run headlessly. This
// shims the SAME window.showDirectoryPicker seam the real app and the Tauri
// adapter use, so no app code needs a test hook.
export async function installFakeProject(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const files: Record<string, string> = {
      'config.json': JSON.stringify({ name: 'from-disk', mode: 'idle' }, null, 2),
      'alt.json': JSON.stringify({ other: true }, null, 2),
    }
    const jigtor: Record<string, string> = {
      'schema.json': JSON.stringify({
        type: 'object',
        properties: {
          name: { type: 'string' },
          mode: { type: 'string', enum: ['idle', 'active'] },
        },
      }),
    }

    const fileHandle = (name: string, content: string): unknown => ({
      kind: 'file',
      name,
      async getFile() {
        return {
          async text() {
            return content
          },
          async arrayBuffer() {
            return new TextEncoder().encode(content).buffer
          },
        }
      },
      async createWritable() {
        return { async write() {}, async close() {} }
      },
    })

    const dirHandle = (
      name: string,
      entries: Record<string, string>,
      subdirs: Record<string, Record<string, string>>,
    ): unknown => ({
      kind: 'directory',
      name,
      async *values() {
        for (const k of Object.keys(entries)) yield { kind: 'file', name: k }
        for (const k of Object.keys(subdirs)) yield { kind: 'directory', name: k }
      },
      async getFileHandle(fn: string, opts?: { create?: boolean }) {
        if (!(fn in entries)) {
          if (opts && opts.create) return fileHandle(fn, '')
          throw new Error(`not found: ${fn}`)
        }
        return fileHandle(fn, entries[fn])
      },
      async getDirectoryHandle(dn: string, opts?: { create?: boolean }) {
        if (!(dn in subdirs)) {
          if (opts && opts.create) return dirHandle(dn, {}, {})
          throw new Error(`no dir: ${dn}`)
        }
        return dirHandle(dn, subdirs[dn], {})
      },
    })

    const w = window as unknown as { showDirectoryPicker?: unknown }
    w.showDirectoryPicker = async () => dirHandle('demo-project', files, { '.jigtor': jigtor })
  })
}

// Install the fake project, boot, open the folder, and connect the given config
// candidate from the explorer — the common setup for save/history specs.
export async function openFakeProjectAndPick(page: Page, fileName = 'config.json'): Promise<void> {
  await installFakeProject(page)
  await page.goto('/')
  await page.locator('#open-project').click()
  await page.locator('#project-tree .tree-link', { hasText: fileName }).click()
}
