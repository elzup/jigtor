---
id: review:adversary-r2
title: Adversary Review R2 (re-audit of R1 fixes)
coherence:
  depends_on:
    - review:adversary-r1
    - spec:parser
    - spec:validator
    - spec:renderer
    - design:schema-model
---

# Adversary Review R2

**Reviewer:** claude_opus-4-8 (fresh context, artifacts-only)
**Target:** src/core/*.ts @ post-R1-fix
**Verdict:** R1 fixes all verified (FIND-001..006 PASS), but 2 regressions + 2 slop gaps → overall FAIL, all resolved.

## Findings & resolution

| ID | Sev | Dim | Summary | Route | Fix |
|----|-----|-----|---------|-------|-----|
| FIND-R2-001 | medium | correctness | `stripRefs` deleted any key named `$ref` incl. a config property named `$ref` → silent false-VALID | 2b | position-aware `stripRefs`: strips $ref only at schema keyword slots, recurses only through schema-bearing keywords; preserves `properties` keys & data keywords |
| FIND-R2-002 | medium | spec_fidelity | required child of unsupported type: parser skipped field but validator still demanded it → unfixable UI error | 1 | REQ-P10 revised: emit read-only `kind:'unknown'` placeholder (keeps path/required) so the error renders; renderer handles it |
| FIND-R2-003 | low | test_slop | `PROP-V02` was a vacuous `typeof === 'function'` assertion | 2a | replaced with property: required prop enforced for ANY name incl. `$ref` (locks FIND-R2-001) |
| FIND-R2-004 | low | test_slop | REQ-V04 nested `[...parent, key]` path never tested | 2a | added nested missing-required test asserting `['nested','flag']` |

## R1 fix verification (all PASS, confirmed by executed inputs)

- FIND-001: sibling-of-$ref subset still enforced (`{a:123}` → invalid); recursive `$ref` no throw.
- FIND-002: object/root `.field-error` rendered, no duplication (object branch early-returns).
- FIND-005: root hard-error preserved; siblings survive.
- FIND-006: exact `config.json` match verified.
- REQ-V03/V04 pointer normalization PASS for array indices (`['items','1','id']`) and escaped keys (`['a/b']`, `['x~y']`).

→ R3 re-audit with fresh context (see review:adversary-r3).
