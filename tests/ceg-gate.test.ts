// VCSDD gate — the coherence graph must stay a consistent DAG (no missing deps,
// no cycles). Fails CI if a spec references a non-existent node or a cycle forms.
import { test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const cegTool = resolve(here, '..', 'tools', 'ceg.mjs')
const specsDir = resolve(here, '..', '.vsdd', 'config-editor', 'specs')

test('CEG: coherence graph is consistent', () => {
  const r = spawnSync('node', [cegTool, 'validate', '--specs', specsDir], { encoding: 'utf8' })
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
})
