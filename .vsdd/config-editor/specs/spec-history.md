---
id: spec:history
title: フィールド単位の保存履歴
coherence:
  depends_on:
    - spec:changelog
    - design:schema-model
---

# spec:history

このツール上で編集し **保存 (export/commit) した** 変更を、フィールドごとに時系列で
追えるようにする。キーストローク単位ではなく、**保存の瞬間の差分**だけを記録する
(ユーザー要望: 「保存までしたもの」をフィールドごとに追いたい)。

`recordSave` / `fieldHistory` / `historyPaths` は純粋関数 (`src/core/history.ts`)。
時刻 `at` は注入 (`Date.now()` を関数内で読まない) し、決定性を保つ。

## 要件 (EARS)

- REQ-H01: WHEN ユーザーが config を保存する
  THE SYSTEM SHALL 直前に保存された config と今回の config を `diffConfig` で比較し、
  **変更フィールド 1 件につき 1 エントリ** を保存時刻 `at` 付きで履歴末尾に追加する。
- REQ-H02: IF 保存時に差分が無い (no-op save)
  THEN THE SYSTEM SHALL 履歴を一切変更しない。
- REQ-H03: THE SYSTEM SHALL 各エントリに `path` / `before` / `after` / `kind`
  (`added`|`removed`|`changed`) / `at` を保持する。
- REQ-H04: THE SYSTEM SHALL 履歴を **append-only** として扱い、入力配列を破壊しない
  (毎回新しい配列を返す)。
- REQ-H05: WHERE あるフィールド `path` の履歴を要求される
  THE SYSTEM SHALL その path に**完全一致**するエントリだけを挿入順 (古い→新しい) で返す。
  RATIONALE: `['a']` と `['a','b']` を混同しないよう path は `JSON.stringify` で同定する。
- REQ-H06: THE SYSTEM SHALL 履歴を持つフィールド path の一覧を **初出順** で重複なく返す
  (`historyPaths`)。
- REQ-H07: THE SYSTEM SHALL 履歴を localStorage に永続化し、次回起動時に復元する。
  IF 保存データが壊れている THEN THE SYSTEM SHALL 空履歴として扱い例外を投げない。

## UI

- 「History」タブでフィールドごとにグルーピングして表示する。各フィールドは
  ドット記法パス (REQ-R17 と一貫: `.server.port`) を見出しにし、配下に
  `before → after` と保存時刻を古い順で並べる。
- 履歴の同定・表示は path 単位。schema 外フィールド (unknown) の変更も config 差分に
  現れるため同様に追跡される。
