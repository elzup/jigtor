# jigtor — Practical Usage Flow

Local-first, schema-driven `config.json` editor. This document describes how you
actually use it end to end, plus the decisions that are still open for V1.

> 日本語版: [`USAGE.ja.md`](./USAGE.ja.md)

## As-built flow (what works today)

```
open app ──▶ load schema + config ──▶ edit (live validation) ──▶ review diff ──▶ export config.json
                    │                        │                                         │
              (or infer schema         (unsaved-change prompt)                  (session saved to
               from config only)                                                localStorage, auto-restored)
```

### 1. Open the app

Static web app, no backend, nothing leaves the browser.

- Dev: `nr dev` → `http://jigtor.localhost` (via portless)
- Prod: `nr build`, then open/host `dist/` anywhere (even `file://`)

### 2. Load your files

Load a **JSON Schema** and a **config** file via file picker or drag-and-drop.

- No schema? Load the config alone and click **Generate schema from config** to
  get an editable draft schema (types inferred, round-trip safe).
- **Load example** boots a demo (schema + config) to try the tool immediately.

### 3. Edit through generated controls

The form is generated from the schema, with type-appropriate widgets:

| Schema shape | Widget |
|---|---|
| `string` (plain) | text input |
| `string` long (`maxLength >= 80`) | textarea |
| `string` + `enum` (≤ 6 options) | radio group |
| `string` + `enum` (> 6 options) | select |
| `number` / `integer` with **both** `minimum` and `maximum` | slider + number input |
| `number` / `integer` otherwise | number input |
| `boolean` | toggle |
| `object` | nested fieldset |
| `array` | read-only JSON (editable array UI is V2) |

- **Live validation** (ajv): errors appear beside each field as you type; the
  input you are editing is never rebuilt, so slider drag / text caret stay smooth.
- **Dotted path** (`.server.port`) is shown on every field so you always know
  where in the config you are.
- **Unsaved-change prompt**: the Save button shows `Review & save… (N)` with the
  number of pending changes, a footer note reminds you they are not exported yet,
  and closing the tab with unsaved changes triggers a browser confirm.

### 4. Adjust the schema (Schema tab)

Edit the schema as flat `.dir.field` rows — key, type, default, and validation
(`min`/`max`, `minLen`/`maxLen`/`pattern`, `enum`, `required`). A live **sample
JSON preview** shows a valid config produced from the current schema. Raw schema
JSON stays available behind a toggle.

### 5. Review & save

**Review & save…** shows a **diff** (loaded baseline vs current) and the validity
state before you export. Export downloads `config.json` (2-space indent). Export
is allowed even when invalid — you are never blocked from saving your work.

### 6. Session continuity

The last schema + config is persisted to `localStorage` and auto-restored on the
next visit. **Forget saved** clears it.

## Supported JSON Schema subset (V1)

`type` (`object` / `string` / `number` / `integer` / `boolean` / `array`),
`properties`, `required`, `default`, `description`, `title`, `enum`,
`minimum` / `maximum`, `minLength` / `maxLength` / `pattern`, simple `items`.

Unsupported (`$ref`, `oneOf` / `anyOf` / `allOf`, conditionals, remote schemas)
degrade gracefully: such fields render as read-only placeholders and validation
ignores the reference instead of failing the whole config.

## Open decisions (not yet settled for V1)

These affect the "real deployment" story and are intentionally undecided:

1. **Directory layout** — where config/schema/log live (e.g. a `.jigtor/`
   folder next to the config), and the schema file-name convention
   (`schema.json` vs `config.schema.json` vs a `$schema` field inside the config).
2. **Save mechanism** — download-only (today) vs direct overwrite via the File
   System Access API vs a Tauri native wrapper.
3. **Log / history** — a single log file vs versioned history (e.g. gzipped
   snapshots) that can be restored.
4. **Schema-external fields** — fields present in the config but absent from the
   schema. Today the renderer keeps them via a read-only "unknown" placeholder;
   the policy (log to console + preserve vs ignore) is not yet finalized.

## Architecture (for contributors)

Pure, UI-neutral TypeScript in `src/core/` (`parseSchema` → `validateConfig` →
`renderForm`, plus `inferSchema` / `applyDefaults` / `diffConfig` / `schemaEdit`),
driven by a thin DOM shell in `src/main.ts`. Built with VCSDD; the full spec
graph and adversarial-review trace live in `.vsdd/config-editor/`.
