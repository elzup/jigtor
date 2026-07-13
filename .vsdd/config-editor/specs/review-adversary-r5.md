---
id: review:adversary-r5
title: Adversary Review R5 (new features: defaults / infer / widgets)
coherence:
  depends_on:
    - spec:defaults
    - spec:schema-infer
    - spec:renderer
    - design:schema-model
---

# Adversary Review R5

**Reviewer:** claude_opus-4-8 (fresh context, artifacts-only)
**Target:** applyDefaults.ts, inferSchema.ts, renderForm.ts (widgets), parseSchema.ts (example) @ first cut
**Verdict:** FAIL — 1 HIGH + 1 medium, both resolved.

## Findings & resolution

| ID | Sev | Dim | Summary | Route | Fix |
|----|-----|-----|---------|-------|-----|
| FIND-R5-001 | high | correctness | applyDefaults treated a PRESENT non-object (scalar/array/null) at an object-typed field as missing → fabricated an object and silently destroyed the value (REQ-D03/D05) | 2b | object branch returns `current` untouched when present-but-not-object |
| FIND-R5-002 | medium | test-slop | no test fed a type-mismatched value at an object field (PROP-D01 derives schema from config so types always agree) | 2a | added unit test (scalar/array/null preserved) + PROP-D03 fuzzing any value at an object field |

## Verified holding (adversary could not break)

- inferSchema round-trip invariant: mixed arrays `[0,false]`, int/float mix, nested arrays-of-objects, `1e21`, `[null,1]`, empty array/object all validate against their inferred schema (`inferArrayItems` homogeneous-primitive-only logic).
- inferSchema & applyDefaults immutability.
- Renderer REQ-R11..R14: slider+number sync, empty→undefined, textarea `>=80` boundary, `.toggle` class, `data-path` on rich widgets, `step=any` for float, single-input fallback when a bound is missing.

→ R6 convergence audit follows.
