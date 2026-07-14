---
id: review:adversary-r14
title: Adversary Review R14 (object-array subforms — recursion PASS)
coherence:
  depends_on:
    - review:adversary-r13
    - spec:renderer
---

# Adversary Review R14

**Reviewer:** general-purpose (fresh context, Opus)
**Target:** REQ-R20 object-array subforms — `arrayEditor` / `subValueEditor` / `objectFields` / `jsonValueEditor` / `itemDefault` recursion.
**Verdict:** **PASS — zero critical, zero high.**

Seven attack vectors traced by hand AND verified empirically (8 adversarial jsdom scenarios, all passed):

1. **Closure clobber (nested state)** — PASS. `objectFields` keeps a shared mutable `let current` read at edit-time; each level's local copy stays authoritative, no alternate write path to a subtree. Interleaved 3-level edits drop nothing.
2. **Stale index after reorder/remove** — PASS. Every structural op calls `drawRows()` → `replaceChildren()` + fresh per-`forEach` `i`; value edits don't change indices. No write-to-wrong-index reachable.
3. **Nested-array emit** — PASS. Nested `arrayEditor` builds its own `[...]` copy and emits the whole nested array up through `{...current,[key]:nested}`; all arrays fresh, no aliasing.
4. **`itemDefault` empty object** — PASS. No-required → `{}`; editing an optional field adds the key correctly.
5. **array-of-array / array-of-unknown** — PASS. Outer up/down/rm are direct siblings of the recursive editor; outer controls emit the whole outer array independently of nested buttons.
6. **No array-index path into `setAt`** (critical) — PASS. The array branch is the only recursion entry; `onValue` always calls `onChange(field.path, wholeArray)`; index `i` is used only inside `items.map`, never in a path. `main.ts setAt` never sees a numeric segment.
7. **reset/diff/meta granularity** — PASS. Arrays carry one whole-array `.field-meta`; dirty/reset operate at whole-array granularity (documented; no per-item reset expected).

**One LOW test-gap (FAIL → fixed):** the REQ-R20 tests covered only single-level object items. Added 4 regression tests — deep object-in-object-in-array interleaved edits, edit→reorder-other→re-edit index safety, nested-array-in-object-item, array-of-array outer reorder — locking the recursion-depth paths that were previously only manually verified. 143 tests green; build 47.9 KB gzip.
