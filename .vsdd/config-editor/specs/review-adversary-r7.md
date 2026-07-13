---
id: review:adversary-r7
title: Adversary Review R7 (diff engine + renderer refactor)
coherence:
  depends_on:
    - spec:changelog
    - spec:renderer
---

# Adversary Review R7

**Reviewer:** claude_opus-4-8 (fresh context)
**Target:** diffConfig.ts, renderForm.ts (errbox/refreshErrors refactor), main.ts (tabs/save)
**Verdict:** FAIL — 1 HIGH + 1 low.

| ID | Sev | Summary | Fix |
|----|-----|---------|-----|
| FIND-R7-001 | high | diff baseline `state.original` showed machine-seeded defaults as user changes (schema-only & config-first flows) | set baseline at end of buildForm() |
| FIND-R7-002 | low | errbox matching keyed on '/'-join collided for keys containing '/' | `errKey = JSON.stringify(path)` for errbox match |

diffConfig REQ-CL01..CL09 verified clean (null-vs-missing, arrays-whole, deterministic order, round-trip). refreshErrors clears+replaces without stale/duplicate nodes.
