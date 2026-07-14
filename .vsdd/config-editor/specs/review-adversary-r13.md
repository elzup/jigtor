---
id: review:adversary-r13
title: Adversary Review R13 (convergence — UX pack PASS)
coherence:
  depends_on:
    - review:adversary-r12
    - spec:renderer
    - spec:history
---

# Adversary Review R13

**Reviewer:** general-purpose (fresh context, Opus)
**Target:** the R12 fixes (FIND-A1..A5) + regression hunt
**Verdict:** **PASS — converged (zero critical, zero high)**.

All five R12 findings confirmed genuinely resolved, not band-aided:

- **A1 (was HIGH)** — baseline now folds in machine-seeded defaults (`applyDefaults(root, original)` on in-session schema apply). Adversary specifically tried to (a) make it hide a legit change, (b) regress FIND-R8 (edits before schema apply), (c) corrupt nested objects via aliasing — all impossible: `applyDefaults` fills missing keys only and the two trees are independently deep-cloned. reset target is now defined → `setAt`, killing the `deleteAt`→re-seed loop.
- **A2 (was MED)** — number array items emit `Number(value)` (empty→0), never undefined→null. Scalar-vs-array difference is justified by container semantics (a property may be absent; an array element may not be a hole).
- **A3 (was MED)** — `parseHistory` extracted, tested (null/corrupt/non-array/round-trip), never throws; `loadHistory` delegates.
- **A4 (was LOW)** — `Array.isArray` guard rejects scalars/objects/null with an inline note; valid arrays still commit.
- **A5 (was LOW)** — REQ-R02/R11/R19 spec now internally consistent and matches code+tests.

**Two LOW residuals** the reviewer logged (neither reachable from the app's own writes) were hardened post-R13: `parseHistory` now `filter`s to entries carrying a `path` array (drops tampered shapes); the number-item input guards `Number.isNaN(v) ? 0 : v`. Regression tests added for both. 138 tests green, `tsc` clean, build 47.6 KB gzip.
