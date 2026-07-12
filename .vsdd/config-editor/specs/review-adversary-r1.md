---
id: review:adversary-r1
title: Adversary Review R1
coherence:
  depends_on:
    - spec:parser
    - spec:validator
    - spec:file-io
    - spec:renderer
    - design:schema-model
---

# Adversary Review R1

**Reviewer:** claude_opus-4-8 (fresh context, artifacts-only)
**Target:** src/core/*.ts @ working tree (pre-fix)
**Verdict:** overall FAIL → 6 findings, all resolved in Phase 4.

## Findings & resolution

| ID | Sev | Dim | Summary | Route | Fix |
|----|-----|-----|---------|-------|-----|
| FIND-001 | critical | spec_fidelity | Unresolvable `$ref` makes `ajv.compile` throw → whole config falsely invalid (REQ-V06) | 2b | `stripRefs()` removes `$ref`/`$recursiveRef`/`$dynamicRef` before compile |
| FIND-002 | high | correctness | `renderForm` object branch dropped `.field-error` for object/root nodes (REQ-R06) | 2c | object branch now renders `errorsFor(field.path)` |
| FIND-003 | high | test_slop | REQ-V06 test only asserted `not.toThrow`, masked FIND-001 | 2a | now asserts `valid===true` for a $ref schema + subset still enforced |
| FIND-004 | medium | test_slop | REQ-R06 test never covered object-node / root errors | 2a | added object-node and root-path error tests |
| FIND-005 | medium | spec_fidelity | parser aborted whole parse on one unsupported child; P02/P09 inconsistent | 1 | REQ-P02 scoped to root; added REQ-P10 best-effort skip |
| FIND-006 | low | structural | `*.config.json` broadened beyond REQ-F06 | 2b | exact `config.json` match only |

## CEG impact confirmed

`stripRefs` / renderer changes are local to `spec:validator` and `spec:renderer`;
downstream of `spec:validator` is only `spec:renderer`, which was re-tested.
Spec change (REQ-P10) touches `spec:parser` → downstream `spec:renderer` re-tested.

→ R2 re-audit required with fresh context (see review:adversary-r2).
