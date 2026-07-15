# VCSDD Convergence Record — config-editor (jigtor V1 core)

**Status:** CONVERGED (2026-07-14) · mode: Lean · Adversary rounds: 4 (core) + 2 (feature pack) + 3 (UX) + 2 (schema editor) + 2 (UX pack) + 1 (subforms) · + Cycle 7 UX/e2e (user-driven, no adversary)

## Cycle 7 — UX polish + e2e safety net

User-driven UX iteration (not a full adversary cycle). As-built changes to the
DOM shell plus a first end-to-end layer. No numbered core REQ changed; 181 unit
tests stayed green throughout.

- **File management relocated**: the project-files explorer + reconnect/connection
  alerts moved out of the tab-scoped Edit panel into an always-visible management
  column beside the drop zone (they previously vanished on the Schema/History
  tabs). The explorer lists only JSON candidates + `.jigtor/` artifacts.
- **Config candidate selection is now in the explorer** (supersedes the button-row
  modal): a folder with several JSONs shows them as clickable "pick" entries;
  selection carries the connection mode so a multi-candidate reconnect still
  preserves restored edits. Directory drag-and-drop opens a folder as a project.
  Still satisfies REQ-RD02/04 (reads `config.json`, saves back, generate-on-missing).
- **Live diff is always shown** (collapse removed); the **Review changes dialog no
  longer repeats the whole-file diff** — it shows a change-count summary + validity
  (supersedes the Cycle-3 "dialog shows the diff" note below).
- **Tree mode** surfaces schema-external keys with a non-blocking "not in schema"
  badge (see DECISIONS — resolves the open lean), color-coded type chips, lazy
  per-field history, column-aligned controls; flat inline-SVG icons replace emoji.
- **Compact fields** reflow via grid (bounded input track), not padding.
- **Demo** reworked: `key`→`name`, dropped the confusing `max`, added `ratio`
  (number) + `retries` (integer) slider samples.

**e2e**: Playwright suite (`e2e/*.spec.ts`, `nr test:e2e`) drives the whole
`main.ts` shell in real Chromium — the layer unit tests never touch. 12 tests over
8 specs: load-example, block edit → live diff + count, compact toggle, tree
schema-external badge + undo, type chips, schema sample + tab switching, project
open → explorer candidate pick → switch (via a `showDirectoryPicker` FS shim),
save flow (lean dialog + direct write), Block↔Tree edit persistence, History after
two saves. Assertions are user-visible (role/text/id) so they can guard a future
React rewrite. 181 unit + 12 e2e green.

## Cycle 6 — object-array subforms (recursive, collapsible)

CONVERGED after R14 (PASS, zero critical/high). `arrayEditor` unified & recursive:
object items render as collapsible `<details>` subforms (fold + stepped accent
rail for depth, not stacked boxes); `subValueEditor`/`objectFields` compose via a
shared-mutable `current` read at edit-time; structural ops redraw only the editor's
rows (no full form rebuild); every change emits the WHOLE array so no array-index
path reaches the object-shaped `setAt`. R14 traced 7 attack vectors (closure
clobber, stale index, nested-array emit, itemDefault, array-of-array, path
integrity, meta granularity) — all PASS; the one LOW test-gap was closed with 4
recursion-depth regression tests. 143 tests green; build 47.9 KB gzip.

## Cycle 5 — UX pack (editable arrays, per-field meta, free input, save history)

CONVERGED after R12→R13. Added/changed:

| Spec node | REQs | Impl | Tests |
|-----------|------|------|-------|
| spec:renderer (+R17,R18,R19,R20) | dotted paths; root flatten; per-field live/dirty/reset meta; unconstrained input; editable arrays | src/core/renderForm.ts | tests/renderForm.test.ts (35) |
| spec:history | H01–H07 | src/core/history.ts | tests/history.test.ts (8) + integration |
| (UI) | History tab, live JSON preview, dotted paths, save-prompt, modern light-dark() CSS | src/main.ts, src/style.css | tests/integration.test.ts |

- **REQ-R17**: every field shows its root-anchored dotted path (`.server.port`). **REQ-R04**: root object flattened (no enclosing fieldset/legend).
- **REQ-R18**: per-field meta row — live `"key": value`; when changed, `"key": before → "key": after` + reset, refreshed in place (no input rebuild).
- **REQ-R19**: no native input constraints (maxLength/pattern/min/max/step); violations surface as ajv warnings only.
- **REQ-R20**: editable arrays — primitive items get per-item rows (add/remove/reorder), complex items fall back to a JSON textarea that commits only a valid array.
- **spec:history**: full-config versioned snapshots (`recordSnapshot`/`deriveFieldEntries`/`fieldHistory`/`historyPaths`/`parseHistory`), gzip-compressed at `.jigtor/history.json.gz` (localStorage mirror), capped at latest 200; per-field view DERIVED by diffing consecutive versions, shown in a History tab grouped by field.

Adversary **R12** = FAIL (1 HIGH reset no-op via applyDefaults re-seed loop; 1 MED number-array undefined→null; +H07 untested, A4 unguarded JSON, R02/R19 spec contradiction) → all fixed. **R13** = PASS (zero critical/high; each fix confirmed non-band-aided, FIND-R8 non-regression verified) + 2 LOW residuals hardened. 138 tests green; build 47.6 KB gzip.

---

**Status:** CONVERGED (2026-07-13) · mode: Lean · Adversary rounds: 4 (core) + 2 (feature pack) + 3 (UX) + 2 (schema editor)

## Cycle 4 — structured schema editor + sample preview

CONVERGED after R10→R11. Added:

| Spec node | REQs | Impl | Tests |
|-----------|------|------|-------|
| spec:schema-edit | SE01–SE09 | src/core/schemaEdit.ts | tests/schemaEdit.test.ts (13) + PROP-SE01/02 |
| (UI) | structured Schema tab + live sample preview | src/main.ts | — |

- `flattenSchema`/`editSchemaField`/`addSchemaField`/`removeSchemaField` edit the schema as flat `sub.hoge` field rows (type/default/validation/required), immutably.
- `sampleFromSchema` builds a live sample-config preview; the sample is kept valid (enum reconciled with sibling constraints, required-absent filled, minItems honored) — invalid author `default` is best-effort.
- Schema tab: per-field controls + Add/Remove field + sample JSON preview; raw JSON kept behind a toggle. Schema edits preserve the diff baseline (in-session).

Adversary R10 caught invalid-sample generation (2 HIGH incl. the vacuous test that hid it) → fixed; R11 PASS. 118 tests green; build 45.5 KB gzip.

---

**Status:** CONVERGED (2026-07-13) · mode: Lean · Adversary rounds: 4 (core) + 2 (feature pack) + 3 (UX)

## Cycle 3 — UX (diff/save, tabs, radio, widget jank fix, session recall)

CONVERGED after R7→R9. Added/changed:

| Spec node | REQs | Impl | Tests |
|-----------|------|------|-------|
| spec:changelog | CL01–CL09 | src/core/diffConfig.ts | tests/diffConfig.test.ts (10) + PROP-CL01/02 |
| spec:renderer (+R15,R16) | radio enum; in-place error refresh | src/core/renderForm.ts (errbox + refreshErrors) | tests/renderForm.test.ts |
| (UI) | tabs Edit/Schema, submit-anytime + diff confirm, localStorage session recall | src/main.ts | tests/integration.test.ts (baseline) |

- **REQ-R15**: small string enum → radio group (else select).
- **REQ-R16**: errors refresh into per-field `.field-errbox` without recreating inputs → fixes slider-drag / text-caret jank (user-reported "unnatural").
- **Submit anytime**: Download no longer gated on valid; a "Review changes" dialog shows the diff (loaded baseline vs current) + validity before export.
- **Session recall**: last schema+config persisted to localStorage, auto-restored on startup, "Forget saved" clears it.

Adversary: **R7** HIGH (diff showed seed-defaults as edits) → fixed; **R8** HIGH regression (over-eager baseline reset wiped edits on apply-schema) → fixed with a `baselineEstablished` flag; **R9** PASS (flows A–G, persistence crash-safety). 103 tests green; build 43.2 KB gzip.

---

# Cycle 1+2 record

**Status:** CONVERGED (2026-07-13) · mode: Lean · Adversary rounds: 4 (core) + 2 (feature pack)

## Cycle 2 — feature pack (rich widgets / example-default init / schema inference)

CONVERGED after R5→R6. Added nodes:

| Spec node | REQs | Impl | Tests |
|-----------|------|------|-------|
| spec:defaults | D01–D07 | src/core/applyDefaults.ts | tests/applyDefaults.test.ts (10) |
| spec:schema-infer | I01–I07 | src/core/inferSchema.ts | tests/inferSchema.test.ts (7) |
| spec:renderer (+R11–R14) | slider/textarea/toggle | src/core/renderForm.ts | tests/renderForm.test.ts |
| (harden) | infer round-trip, defaults no-overwrite | — | tests/properties.test.ts (PROP-I/D) |

Adversary: **R5** found 1 HIGH (applyDefaults silently clobbered a present non-object at an object-typed field) + the test-slop that hid it; both fixed. **R6** = zero critical/high after 29 probes → converged. UI wired in src/main.ts (default seeding on load, "Generate schema from config", editable schema panel). 85 tests green; build 41.9 KB gzip.

---

# Cycle 1 record

**Status:** CONVERGED (2026-07-13) · mode: Lean · Adversary rounds: 4

## Bead traceability (REQ → TEST → IMPL)

| Spec node | REQs | Impl | Tests |
|-----------|------|------|-------|
| design:schema-model | model + invariants | src/core/types.ts | (typed; used by all) |
| spec:parser | P01–P10 | src/core/parseSchema.ts | tests/parseSchema.test.ts (13) |
| spec:validator | V01–V06 | src/core/validateConfig.ts | tests/validateConfig.test.ts (11) |
| spec:file-io | F01–F06 | src/core/fileIo.ts | tests/fileIo.test.ts (6) |
| spec:renderer | R01–R09 | src/core/renderForm.ts | tests/renderForm.test.ts (14) |
| (integration) | end-to-end | src/main.ts (shell) | tests/integration.test.ts (4) |
| (harden) | invariants | — | tests/properties.test.ts (6, fast-check) |
| (CEG gate) | graph DAG | tools/ceg.mjs | tests/ceg-gate.test.ts (1) |

Total: **55 tests**, all green. `tsc --noEmit` clean. `vite build` = 40.8 KB gzip.

## Adversary trajectory (Anti-Slop, Forced Negativity, fresh context each round)

| Round | Findings | Notable |
|-------|----------|---------|
| R1 | 6 (1 crit, 2 high) | $ref fail-closed; object-node errors dropped; test slop |
| R2 | 4 (2 med) | stripRefs over-strip regression; required-unsupported-child unfixable |
| R3 | 3 (1 high) | `dependencies`+$ref fail-closed; +compile-cache perf fix |
| R4 | 2 (1 med, 1 low) | orphan-error visibility (fixed via REQ-R09); cache-mutation caveat (accepted) |

Convergence: R4 = zero critical, zero high → PASS. Findings trend 6→4→3→0(high).

## Reviews as CEG nodes
review:adversary-r1 → r2 → r3 → r4 (each depends_on the audited specs).
`node tools/ceg.mjs validate --specs .vsdd/config-editor/specs` → OK (enforced by tests/ceg-gate.test.ts).

## Deferred to V2 (out of V1 scope)
- $ref resolution (currently: unsupported child → read-only `unknown` placeholder; validation strips $ref).
- oneOf/anyOf/allOf, conditional schemas, remote schemas.
- Editable array UI (V1 renders arrays read-only).
- Tauri native wrapper.
