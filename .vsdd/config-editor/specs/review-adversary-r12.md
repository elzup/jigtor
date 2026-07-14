---
id: review:adversary-r12
title: Adversary Review R12 (UX pack — arrays, per-field meta, free input, history)
coherence:
  depends_on:
    - review:adversary-r11
    - spec:renderer
    - spec:history
---

# Adversary Review R12

**Reviewer:** general-purpose (fresh context, Opus)
**Target:** REQ-R18/R19/R20 (renderForm.ts) + spec:history (history.ts, main.ts wiring)
**Verdict:** FAIL — 1 HIGH + 1 MEDIUM (+ 2 verification/spec gaps, 1 LOW), 4 refuted concerns PASS.

| ID | Sev | Summary | Fix |
|----|-----|---------|-----|
| FIND-A1 | high | reset was a permanent no-op for an in-session schema-added defaulted field: `deleteAt` removed the key, then `buildForm`'s `applyDefaults` re-seeded the default → field dirty forever, dead reset button | buildForm now folds seeded defaults into the baseline too (`state.original = applyDefaults(root, original)`) so the field is non-dirty and its reset target is defined |
| FIND-A2 | medium | empty number array item emitted `undefined` → serialized to a stray `null` in preview/diff/history/export | number item input emits `Number(n.value)` (empty → 0, a valid element) |
| FIND-A3 | medium | REQ-H07 (localStorage persistence / corrupt-data guard) wholly untested | extracted pure `parseHistory(raw)` into history.ts + tests (null/corrupt/non-array/round-trip) |
| FIND-A4 | low | `jsonArrayEditor` committed ANY parsed JSON (scalar/object) to an array field | added `Array.isArray(parsed)` guard + inline note; commit only arrays |
| FIND-A5 | low | spec contradiction: REQ-R02 mandated integer `step=1` while REQ-R19 forbids native step | REQ-R02 now notes REQ-R19 supersedes; `step=1` survives only on the slider `range` |

**Refuted (documented PASS):** stale-closure item index in `primitiveArrayEditor` (every index-mutating op redraws with fresh `i`, value edits never fire against a reordered layout); `refreshFieldMeta` idempotency (clears all `.field-dirty` + `replaceChildren` before rebuild); slider clamp never overwrites `state.config` (always `onChange(Number(raw))`); history no-op returns same ref.

Fixes landed with regression tests (integration FIND-A1; renderForm FIND-A2/A4; history REQ-H07). 138 tests green. Re-review → R13.
