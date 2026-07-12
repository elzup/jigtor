---
id: review:adversary-r3
title: Adversary Review R3 (convergence gate)
coherence:
  depends_on:
    - review:adversary-r2
    - spec:parser
    - spec:validator
    - spec:renderer
---

# Adversary Review R3

**Reviewer:** claude_opus-4-8 (fresh context, artifacts-only)
**Target:** src/core/*.ts @ post-R2-fix
**Verdict:** R2 fixes verified; 1 HIGH + 2 LOW remained → FAIL, all resolved.

## Findings & resolution

| ID | Sev | Dim | Summary | Route | Fix |
|----|-----|-----|---------|-------|-----|
| FIND-R3-001 | high | correctness | `stripRefs` omitted draft-07 `dependencies`; a `$ref` inside it survived → ajv throws → false root error (fail-closed) | 2b | added `dependencies` (+kept `dependentSchemas`) to SUBSCHEMA_MAP_KEYWORDS; array (property-dependency) form passes through |
| FIND-R3-002 | low | spec_fidelity | renderer `unknown` branch dropped `field.description` (REQ-R08) | 2c | render description before the "unsupported" note |
| FIND-R3-003 | low | coherence | REQ-P10 NOTE said child bad-`items` array → hard error, but impl (correctly) makes it an `unknown` placeholder | 1 | reconciled NOTE: hard error only at root; child arrays are best-effort placeholders |

## Also fixed (perf, surfaced while locking FIND-R3-001)

`validateConfig` constructed a new Ajv + recompiled on every call; the UI
re-validates per keystroke. Added a WeakMap compile cache keyed by schema
reference (leak-free; drops when a new schema file replaces the object).

## R2 fix verification (all PASS)

- Position-aware `stripRefs`: property named `$ref`/`properties`/`items` preserved & enforced (PROP-V02).
- `unknown` placeholder: required $ref child → placeholder with matching path; validator error renders next to it; no duplicate rendering.
- Immutability: `stripRefs` / `parseSchema` build fresh objects, no input mutation.

→ R4 convergence audit follows (see review:adversary-r4).
