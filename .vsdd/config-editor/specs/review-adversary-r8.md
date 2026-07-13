---
id: review:adversary-r8
title: Adversary Review R8 (re-audit of R7 fixes)
coherence:
  depends_on:
    - review:adversary-r7
    - spec:renderer
    - spec:changelog
---

# Adversary Review R8

**Reviewer:** claude_opus-4-8 (fresh context)
**Target:** main.ts baseline + renderForm errKey @ post-R7-fix
**Verdict:** FAIL — the R7-001 fix over-reached (1 HIGH regression).

| ID | Sev | Summary | Fix |
|----|-----|---------|-----|
| FIND-R8-001 | high | baseline reset at end of buildForm() also fired on apply-schema/infer → edits made before an in-session schema tweak vanished from the diff ("No changes" shown falsely) | `baselineEstablished` flag + `markNewData()`: capture baseline once per fresh external data load, not on apply/infer |

R7-002 errKey verified complete & clean (root `[]`→`"[]"`, nested/slash/unicode route correctly; no error becomes a false orphan).
