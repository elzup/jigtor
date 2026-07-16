import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

type Files = Record<string, string>
type Subdirs = Record<string, Files>

// Install an in-memory File System Access directory so the project-folder flows
// (open → pick config in the explorer → switch → save) can run headlessly. This
// shims the SAME window.showDirectoryPicker seam the real app and the Tauri
// adapter use, so no app code needs a test hook.
async function installDir(page: Page, files: Files, subdirs: Subdirs): Promise<void> {
  await page.addInitScript(
    ({ files, subdirs }: { files: Files; subdirs: Subdirs }) => {
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

      const dirHandle = (name: string, entries: Files, subs: Subdirs): unknown => ({
        kind: 'directory',
        name,
        async *values() {
          for (const k of Object.keys(entries)) yield { kind: 'file', name: k }
          for (const k of Object.keys(subs)) yield { kind: 'directory', name: k }
        },
        async getFileHandle(fn: string, opts?: { create?: boolean }) {
          if (!(fn in entries)) {
            if (opts && opts.create) return fileHandle(fn, '')
            throw new Error(`not found: ${fn}`)
          }
          return fileHandle(fn, entries[fn])
        },
        async getDirectoryHandle(dn: string, opts?: { create?: boolean }) {
          if (!(dn in subs)) {
            if (opts && opts.create) return dirHandle(dn, {}, {})
            throw new Error(`no dir: ${dn}`)
          }
          return dirHandle(dn, subs[dn], {})
        },
      })

      const w = window as unknown as { showDirectoryPicker?: unknown }
      w.showDirectoryPicker = async () => dirHandle('demo-project', files, subdirs)
    },
    { files, subdirs },
  )
}

// A two-candidate project (config.json + alt.json) for the explorer/switch specs.
export async function installFakeProject(page: Page): Promise<void> {
  await installDir(
    page,
    {
      'config.json': JSON.stringify({ name: 'from-disk', mode: 'idle' }, null, 2),
      'alt.json': JSON.stringify({ other: true }, null, 2),
    },
    {
      '.jigtor': {
        'schema.json': JSON.stringify({
          type: 'object',
          properties: {
            name: { type: 'string' },
            mode: { type: 'string', enum: ['idle', 'active'] },
          },
        }),
      },
    },
  )
}

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples')

// A single-candidate project whose files ARE the bundled example (config +
// .jigtor/schema.json), so opening it auto-connects — the replacement for the
// removed "Load example" seeding path.
export async function installExampleProject(page: Page): Promise<void> {
  const config = readFileSync(resolve(exampleDir, 'config.json'), 'utf8')
  const schema = readFileSync(resolve(exampleDir, '.jigtor', 'schema.json'), 'utf8')
  await installDir(page, { 'config.json': config }, { '.jigtor': { 'schema.json': schema } })
}

// Install the fake project, boot, open the folder, and connect the given config
// candidate from the explorer — the common setup for save/history specs.
export async function openFakeProjectAndPick(page: Page, fileName = 'config.json'): Promise<void> {
  await installFakeProject(page)
  await page.goto('/')
  await page.locator('#open-project').click()
  await page.locator('#project-tree .tree-link', { hasText: fileName }).click()
}
