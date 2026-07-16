import { describe, test, expect } from 'vitest'
import { tabVisible, type TabAvailability } from '../src/ui/store'

const S0: TabAvailability = { hasConfig: false, hasSchema: false, hasHistory: false }
const S1: TabAvailability = { hasConfig: true, hasSchema: false, hasHistory: false }
const S1h: TabAvailability = { hasConfig: true, hasSchema: false, hasHistory: true }
const S2: TabAvailability = { hasConfig: false, hasSchema: true, hasHistory: false }
const S3: TabAvailability = { hasConfig: true, hasSchema: true, hasHistory: true }

describe('tabVisible (spec:open-flow REQ-OF09)', () => {
  test('S0 (nothing loaded): no tabs', () => {
    expect(tabVisible('edit', S0)).toBe(false)
    expect(tabVisible('schema', S0)).toBe(false)
    expect(tabVisible('history', S0)).toBe(false)
  })

  test('S1 (config only): Edit + Schema (schema as create/infer entry), no History without saves', () => {
    expect(tabVisible('edit', S1)).toBe(true)
    expect(tabVisible('schema', S1)).toBe(true)
    expect(tabVisible('history', S1)).toBe(false)
  })

  test('S1 with save history: History becomes available', () => {
    expect(tabVisible('history', S1h)).toBe(true)
  })

  test('S2 (schema only): Schema only, no Edit (nothing to edit)', () => {
    expect(tabVisible('edit', S2)).toBe(false)
    expect(tabVisible('schema', S2)).toBe(true)
    expect(tabVisible('history', S2)).toBe(false)
  })

  test('S3 (both, with history): all tabs', () => {
    expect(tabVisible('edit', S3)).toBe(true)
    expect(tabVisible('schema', S3)).toBe(true)
    expect(tabVisible('history', S3)).toBe(true)
  })

  test('History needs a connected config even if history exists', () => {
    expect(tabVisible('history', { hasConfig: false, hasSchema: false, hasHistory: true })).toBe(false)
  })
})
