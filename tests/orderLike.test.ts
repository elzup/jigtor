import { describe, it, expect } from 'vitest'
import { orderLike } from '../src/core/orderLike'

const keys = (o: unknown) => Object.keys(o as object)

describe('orderLike', () => {
  it('restores original key order regardless of current order', () => {
    const template = { max: 20, key: 'a', mode: 'idle' }
    const edited = { mode: 'active', key: 'a', max: 99 } // same keys, different order
    expect(keys(orderLike(edited, template))).toEqual(['max', 'key', 'mode'])
  })

  it('appends new keys (not in template) after the ordered ones', () => {
    const template = { a: 1, b: 2 }
    const edited = { b: 2, a: 1, c: 3 }
    expect(keys(orderLike(edited, template))).toEqual(['a', 'b', 'c'])
  })

  it('recurses into nested objects', () => {
    const template = { t: { x: 1, y: 2 } }
    const edited = { t: { y: 2, x: 1 } }
    expect(keys((orderLike(edited, template) as { t: object }).t)).toEqual(['x', 'y'])
  })

  it('keeps array order and aligns element templates', () => {
    const template = { xs: [{ a: 1, b: 2 }] }
    const edited = { xs: [{ b: 2, a: 1 }, { a: 9, b: 9 }] }
    const out = orderLike(edited, template) as { xs: Array<Record<string, unknown>> }
    expect(out.xs.length).toBe(2)
    expect(keys(out.xs[0])).toEqual(['a', 'b'])
  })

  it('preserves values exactly (order-only transform)', () => {
    const template = { a: 1, b: 2 }
    const edited = { b: 5, a: 4 }
    expect(orderLike(edited, template)).toEqual({ a: 4, b: 5 })
  })

  it('passes non-objects through', () => {
    expect(orderLike(42, { a: 1 })).toBe(42)
    expect(orderLike(null, { a: 1 })).toBe(null)
  })
})
