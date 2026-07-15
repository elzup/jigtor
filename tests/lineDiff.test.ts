import { describe, it, expect } from 'vitest'
import { lineDiff } from '../src/core/lineDiff'

const kinds = (before: string[], after: string[]) =>
  lineDiff(before, after).map((l) => `${l.kind === 'same' ? ' ' : l.kind === 'add' ? '+' : '-'}${l.text}`)

describe('lineDiff', () => {
  it('marks every line same when identical', () => {
    expect(kinds(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([' a', ' b', ' c'])
  })

  it('shows a changed line as a delete followed by an add', () => {
    expect(kinds(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([' a', '-b', '+B', ' c'])
  })

  it('marks pure additions', () => {
    expect(kinds(['a', 'c'], ['a', 'b', 'c'])).toEqual([' a', '+b', ' c'])
  })

  it('marks pure removals', () => {
    expect(kinds(['a', 'b', 'c'], ['a', 'c'])).toEqual([' a', '-b', ' c'])
  })

  it('handles empty baseline (all added)', () => {
    expect(kinds([], ['a', 'b'])).toEqual(['+a', '+b'])
  })

  it('handles empty current (all removed)', () => {
    expect(kinds(['a', 'b'], [])).toEqual(['-a', '-b'])
  })

  it('keeps unchanged lines as context around edits', () => {
    const before = ['{', '  "port": 8080,', '  "host": "a"', '}']
    const after = ['{', '  "port": 9090,', '  "host": "a"', '}']
    expect(kinds(before, after)).toEqual([
      ' {',
      '-  "port": 8080,',
      '+  "port": 9090,',
      '   "host": "a"',
      ' }',
    ])
  })
})
