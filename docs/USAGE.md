# jigtor — Practical Usage Flow

Local-first, schema-driven `config.json` editor. This document describes how you
actually use it end to end, plus the decisions that are still open for V1.

> 日本語版: [`USAGE.ja.md`](./USAGE.ja.md)

## As-built flow (what works today)

```
open app ──▶ choose project folder ──▶ edit (live validation) ──▶ review diff ──▶ save config.json in place
                    │                        │                                         │
              (or infer schema         (unsaved-change prompt)                  (session saved to
               from config only)                                                schema/history also saved)
```

### 1. Open the online app

Open the hosted jigtor app in a Chromium-based browser such as Chrome or Edge.
The app is served online, but your `config.json` contents are not sent to the
server.

1. Open the jigtor URL.
2. Click **Open project folder**.
3. Select the project directory that contains `config.json`.
4. Grant the browser permission.

If the same directory contains `schema.json` or `config.schema.json`, jigtor
loads it automatically. If not, you can generate a schema from `config.json`.

#### Directory layout example

For example, if you want to edit `config.json` in `my-device/`, you only need
the target `config.json` at the start.

**Before installing**

```text
my-device/
└── config.json
```

After selecting `my-device/` with **Open project folder**, jigtor reads
`config.json` and saves back to the same file.

**After installing**

```text
my-device/
└── config.json          ← loaded by jigtor
```

After editing, **Review & save…** writes back to `config.json`. If you generate
or adjust a schema, jigtor can write `schema.json`; saved history can be kept in
`.jigtor/history.json`.

**After editing**

```text
my-device/
├── config.json          ← updated in place
├── schema.json          ← optional generated/adjusted schema
└── .jigtor/
    └── history.json     ← optional save history
```

### 2. Load your files

Normally, choose the directory via **Open project folder**. A **JSON Schema** file
is optional.

- No schema? Load the config alone and click **Generate schema from config** to
  get an editable draft schema (types inferred, round-trip safe).
- Browsers without File System Access API support fall back to downloading
  `config.json` instead of writing in place.
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
  number of pending changes, a footer note reminds you they are not saved yet,
  and closing the tab with unsaved changes triggers a browser confirm.

### 4. Adjust the schema (Schema tab)

Edit the schema as flat `.dir.field` rows — key, type, default, and validation
(`min`/`max`, `minLen`/`maxLen`/`pattern`, `enum`, `required`). A live **sample
JSON preview** shows a valid config produced from the current schema. Raw schema
JSON stays available behind a toggle.

### 5. Review & save

**Review & save…** shows a **diff** (loaded baseline vs current) and the validity
state before saving. Save writes back to `config.json` (2-space indent). Saving
is allowed even when invalid — you are never blocked from preserving your work.

### 6. Session continuity

The last schema + config is persisted to `localStorage` and auto-restored on the
next visit. When folder permission is available, save history is also written to
`.jigtor/history.json`. **Forget saved** clears the browser restore data.

## Supported JSON Schema subset (V1)

`type` (`object` / `string` / `number` / `integer` / `boolean` / `array`),
`properties`, `required`, `default`, `description`, `title`, `enum`,
`minimum` / `maximum`, `minLength` / `maxLength` / `pattern`, simple `items`.

Unsupported (`$ref`, `oneOf` / `anyOf` / `allOf`, conditionals, remote schemas)
degrade gracefully: such fields render as read-only placeholders and validation
ignores the reference instead of failing the whole config.

## Open decisions (not yet settled for V1)

These affect the "real deployment" story and are intentionally undecided:

1. **Log / history** — a single log file vs versioned history (e.g. gzipped
   snapshots) that can be restored.
2. **Schema-external fields** — fields present in the config but absent from the
   schema. Today the renderer keeps them via a read-only "unknown" placeholder;
   the policy (log to console + preserve vs ignore) is not yet finalized.

## Architecture (for contributors)

Pure, UI-neutral TypeScript in `src/core/` (`parseSchema` → `validateConfig` →
`renderForm`, plus `inferSchema` / `applyDefaults` / `diffConfig` / `schemaEdit`),
driven by a thin DOM shell in `src/main.ts`. Built with VCSDD; the full spec
graph and adversarial-review trace live in `.vsdd/config-editor/`.
