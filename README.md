# jigtor

Local-first, **schema-driven `config.json` editor**. Open a project folder, edit
`config.json` through generated form controls with live validation, and save
back to the same file. No backend, no data leaves the browser.

Built for configuring devices across varied IoT environments — lightweight and
easy to run in restricted environments.

**Practical usage flow:** [`docs/USAGE.md`](./docs/USAGE.md) · 日本語 [`docs/USAGE.ja.md`](./docs/USAGE.ja.md)

![jigtor editor showing valid and invalid config states](./docs/assets/jigtor-editor.png)

## Use

Open the hosted jigtor app in a Chromium-based browser:

https://elzup.github.io/jigtor/

Choose **Open project folder**, edit `config.json`, then save back to the same
file. Schema and history can be written alongside the project; loaded files and
edits stay in the browser.

## Features (V1)

- Open a project folder and save edits back to `config.json`.
- Load `schema.json` / `config.schema.json` when present, or infer a schema from config.
- Form controls generated from a practical JSON Schema subset.
- Live validation (via [ajv](https://ajv.js.org/)) with errors shown beside each field.
- Save the edited `config.json` in place (download fallback for unsupported browsers).

### Supported JSON Schema subset

`type` (`object` / `string` / `number` / `integer` / `boolean` / `array`),
`properties`, `required`, `default`, `description`, `title`, `enum`,
`minimum` / `maximum`, `minLength` / `maxLength` / `pattern`, and simple `items`.

Unsupported keywords (`$ref`, `oneOf` / `anyOf` / `allOf`, conditionals, remote
schemas) are handled gracefully: such fields render as read-only placeholders and
validation ignores the reference rather than failing the whole config.

## Develop

```bash
ni            # install
nr dev        # dev server (jigtor.localhost via portless)
nr test       # vitest (unit + property-based + integration)
nr typecheck  # tsc --noEmit
nr build      # production build (~40 KB gzip)
```

Try it with the files in `examples/`.

## Architecture

All schema parsing, validation, and rendering is pure, UI-neutral TypeScript in
`src/core/` (`parseSchema` → `validateConfig` → `renderForm`), driven by a thin
DOM shell in `src/main.ts`. See `src/core/types.ts` for the normalized field model.

## Quality: VCSDD

This project was built with **VCSDD** (Verified + Coherence Spec-Driven
Development): EARS specs → tests-first → implementation → adversarial review →
property-based hardening → convergence. The full trace, spec dependency graph
(`tools/ceg.mjs`), and 4 rounds of adversarial review live in
`.vsdd/config-editor/`. See `.vsdd/config-editor/CONVERGENCE.md`.

## Roadmap

- `$ref` resolution and `oneOf`/`anyOf`/`allOf`.
- Editable array UI (V1 is read-only for arrays).
- Optional [Tauri](https://tauri.app/) wrapper for non-Chromium environments.
