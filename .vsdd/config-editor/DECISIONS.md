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
- **Directory layout / jigtor artifacts** — RESOLVED: open a folder containing
  `config.json` (the project root holds only the user's own file). **All jigtor
  artifacts live under `.jigtor/`**, read from the SAME path they are written to
  (no read/write asymmetry): the schema at **`.jigtor/schema.json`**, save history
  at **`.jigtor/history.json.gz`**.
- **Log / history storage** — RESOLVED: **full-config versioned snapshots**, gzip
  compressed at **`.jigtor/history.json.gz`** (plus a `localStorage` mirror), capped
  at the most recent **200** versions. Any past version can be restored; the
  per-field "how did .server.port change" view is DERIVED by diffing consecutive
  versions (`deriveFieldEntries`). (Supersedes the earlier single-file per-field
  append-only log.)

## Open

- **Schema-external fields** — fields present in `config.json` but absent from the
  schema. Today the renderer keeps them as a read-only **`unknown` placeholder**
  (preserved on save, never dropped) and validation ignores them. Still open:
  whether to also **log them to the console** and/or surface a visible "extra
  fields kept" notice, vs the current silent-preserve. Leaning: preserve + a small
  non-blocking notice; no console spam.
