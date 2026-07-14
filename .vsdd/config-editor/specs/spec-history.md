---
id: spec:history
title: バージョン付き保存履歴 (full-config snapshots)
coherence:
  depends_on:
    - spec:changelog
    - design:schema-model
---

# spec:history

このツール上で編集し **保存した** config を、**全体スナップショットのバージョン列**として
残し、任意の過去版を復元できるようにする(ユーザー要望: 「全ファイルのバージョンが
保存されているべき」)。フィールド単位の履歴表示は、隣接バージョンの diff から**導出**する。

`recordSnapshot` / `deriveFieldEntries` / `fieldHistory` / `historyPaths` / `parseHistory`
は純粋関数 (`src/core/history.ts`)。時刻 `at` は注入し決定性を保つ。gzip 圧縮と
File System Access I/O は DOM シェル (`src/main.ts`) 側に置き、core は純粋に保つ。

## 要件 (EARS)

- REQ-H01: WHEN ユーザーが config を保存する
  THE SYSTEM SHALL `{ at, config: <保存版の config 全体> }` のスナップショットを履歴末尾に
  **deep-clone して** 追加する。
- REQ-H02: IF 直前スナップショットと config が同一 (no-op save)
  THEN THE SYSTEM SHALL 履歴を一切変更しない (同一版の重複を作らない)。
- REQ-H03: THE SYSTEM SHALL スナップショットに `at` (epoch ms) と `config` を保持する。
- REQ-H04: THE SYSTEM SHALL 履歴を **append-only** として扱い、入力配列を破壊しない。
  保存後に元 config を変異させてもスナップショットに波及しない (clone 済み)。
- REQ-H05: THE SYSTEM SHALL **最新 N 版** (`DEFAULT_HISTORY_CAP` = 200) だけを残し、
  超過分は古い方から間引く (gzip 後も容量が頭打ちになる)。
- REQ-H06: WHERE フィールド `path` の履歴を要求される
  THE SYSTEM SHALL 隣接バージョンを `diffConfig` し、その path に**完全一致**する変更のみを
  古い→新しい順で返す (`fieldHistory`)。path は `JSON.stringify` で同定 (`['a']` と
  `['a','b']` を混同しない)。最初の版は前版が無いため変更としては現れない。
- REQ-H07: THE SYSTEM SHALL 履歴を `.jigtor/history.json.gz` に **gzip 圧縮**して永続化し、
  **同じパスから読み戻す** (読み書き対称)。localStorage にもフォールバック保存する。
  IF 保存データが壊れている/JSON 不正/非配列/不正な要素 THEN THE SYSTEM SHALL 空 or
  フィルタ済み履歴として扱い例外を投げない (`parseHistory`)。

## 配置 (`.jigtor/` に集約, read=write 対称)

```
project/
├── config.json              ← ユーザーのファイル (root、ここだけ)
└── .jigtor/
    ├── schema.json          ← 現在の schema (読み書き同じパス)
    └── history.json.gz      ← 全バージョンの gzip スナップショット
```

## UI

- 「History」タブでフィールドごとにグルーピング表示 (`historyPaths` の初出順)。各フィールドは
  ドット記法パス (REQ-R17 と一貫: `.server.port`) を見出しにし、配下に版間の
  `before → after` と保存時刻を古い順で並べる。schema 外フィールド (unknown) の変更も
  config 差分に現れるため同様に追跡される。
