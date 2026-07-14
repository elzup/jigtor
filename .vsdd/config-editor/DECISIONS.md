# Design decisions — config-editor (internal, NOT user docs)

Deployment/product decisions and their current status. Kept out of `docs/USAGE.md`
(user-facing) on purpose — a reader complained about seeing "undecided" internals
in the usage guide.

## Resolved

- **Distribution / runtime** — RESOLVED: **hosted web app** (GitHub Pages,
  `https://elzup.github.io/jigtor/`), not a static bundle installed into the
  project folder. (An earlier Releases-zip idea is superseded by the hosted app.)
- **Save mechanism** — RESOLVED: **File System Access API** — "Open project
  folder" / "Open config.json" opens a handle and **saves back in place**.
  Browsers without the API (Safari/Firefox) fall back to downloading `config.json`.
- **Directory layout / schema file name** — RESOLVED: open a folder containing
  `config.json`; schema auto-detected as **`schema.json`** then **`config.schema.json`**.
  On save, a generated/adjusted schema is written as `schema.json`; save history is
  written to **`.jigtor/history.json`**.
- **Log / history storage** — RESOLVED (V1): a **single `.jigtor/history.json`**
  (plus `localStorage`), per-field append-only. Gzipped/versioned snapshots are
  deferred; the single-file log is sufficient for V1.

## Open

- **Schema-external fields** — fields present in `config.json` but absent from the
  schema. Today the renderer keeps them as a read-only **`unknown` placeholder**
  (preserved on save, never dropped) and validation ignores them. Still open:
  whether to also **log them to the console** and/or surface a visible "extra
  fields kept" notice, vs the current silent-preserve. Leaning: preserve + a small
  non-blocking notice; no console spam.
