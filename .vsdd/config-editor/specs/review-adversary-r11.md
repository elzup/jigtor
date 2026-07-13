---
id: review:adversary-r11
title: Adversary Review R11 (convergence — schema-edit PASS)
coherence:
  depends_on:
    - review:adversary-r10
    - spec:schema-edit
---

# Adversary Review R11

**Reviewer:** claude_opus-4-8 (fresh context)
**Target:** schemaEdit.ts @ post-R10-fix
**Verdict:** **PASS — converged (zero critical, zero high)**.

Verified: enum picks a satisfying member (not-first, string len/pattern, number max, integer-ness); required-absent filled at multiple nesting levels while a required key IN properties uses the property sample; array minItems with constrained/object items valid; type-change strips container keywords WITHOUT touching parent `required` membership; `satisfies()` handles max/integer/pattern (invalid regex ignored, no throw); immutability holds.

**Accepted non-finding (LOW):** an author-declared `default` that violates its own constraints is emitted verbatim → invalid sample. Defensible best-effort (default is a single top-priority author value with no alternative to pick, unlike enum); spec REQ-SE09 NOTE updated to state this.
