// Whole-file line diff for the live preview: given the baseline and current
// pretty-printed JSON, produce a unified view of every line — unchanged lines as
// context, with removed/added lines marked. Classic LCS backtrack, no deps.

export type DiffKind = 'same' | 'add' | 'del'
export type DiffLine = { kind: DiffKind; text: string }

export function lineDiff(before: string[], after: string[]): DiffLine[] {
  const n = before.length
  const m = after.length

  // lcs[i][j] = length of the longest common subsequence of before[i:] / after[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        before[i] === after[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: 'same', text: after[j]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'del', text: before[i]! })
      i++
    } else {
      out.push({ kind: 'add', text: after[j]! })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: before[i++]! })
  while (j < m) out.push({ kind: 'add', text: after[j++]! })
  return out
}
