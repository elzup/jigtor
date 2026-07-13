---
id: review:adversary-r10
title: Adversary Review R10 (schema-edit + sample preview)
coherence:
  depends_on:
    - spec:schema-edit
    - design:schema-model
---

# Adversary Review R10

**Reviewer:** claude_opus-4-8 (fresh context)
**Target:** schemaEdit.ts (flatten/edit/add/remove/sampleFromSchema) + main.ts editor UI
**Verdict:** FAIL — 2 HIGH + 1 medium.

| ID | Sev | Summary | Fix |
|----|-----|---------|-----|
| SE09-INVALID-SAMPLE | high | sampleFromSchema emitted INVALID samples for satisfiable schemas: enum[0] ignoring sibling minimum/minLength; required key absent from properties never filled; array minItems ignored | enum picks first member that `satisfies()` siblings; required-absent filled with null; minItems emits N items |
| SE09-TEST-SLOP | high | the only validity property used inferSchema output (no constraints) → vacuous; no negative test for constraint conflict | PROP-SE02 rewritten over CONSTRAINED (satisfiable) schemas + explicit unit tests |
| SE05-PROPERTIES-NOT-STRIPPED | medium | object→scalar type change left orphaned `properties`/`items` | stripIncompatible now drops properties/required (non-object) and items (non-array) |

Immutability, add/remove no-ops, UI parseDefault/enum-parsing all verified correct.
