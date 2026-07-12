---
id: review:adversary-r4
title: Adversary Review R4 (convergence — PASS)
coherence:
  depends_on:
    - review:adversary-r3
    - spec:parser
    - spec:validator
    - spec:renderer
---

# Adversary Review R4

**Reviewer:** claude_opus-4-8 (fresh context, artifacts-only)
**Target:** src/core/*.ts @ post-R3-fix
**Verdict:** **PASS — converged (zero critical, zero high)**

Probed an unresolvable `$ref` in all 17 draft-07 subschema-bearing positions → zero fail-closed.
Nested onChange paths, `unknown` placeholder paths, immutability all correct.

## Findings (non-blocking)

| ID | Sev | Summary | Route | Resolution |
|----|-----|---------|-------|-----------|
| FIND-R4-001 | medium | a `required` key absent from `properties` yields a correct-but-field-invisible error | 1 | REQ-R09 added: orphan errors render in a `.form-errors` summary (no error ever invisible) |
| FIND-R4-002 | low | compile cache correctness relies on unenforced no-in-place-mutation invariant | none | accepted: honored by sole caller (main.ts replaces schema wholesale, edits config immutably); documented at the cache definition |

FIND-R4-001 fixed and re-tested (REQ-R09 tests) though convergence did not require it.
