---
id: spec:open-flow
title: open-flow — ファイル/フォルダを開く状態遷移と接続レベルの昇格ナビ
coherence:
  depends_on:
    - spec:file-io
    - spec:schema-infer
---

# spec:open-flow

jigtor に config / schema を取り込む導線の状態機械。File System Access API は
**ファイルハンドルから親ディレクトリへ遡れない**ため、ファイル単体では
`.jigtor/` サイドカーや兄弟一覧を伴う「プロジェクト接続」に到達できない。よって
劣化を黙認せず、**接続レベルを上げるためのナビゲーション**を明示する。

判定は [[spec:file-io]] の `classifyFile` に従い、取り込んだファイルを config /
schema のどちらのスロットに充てるか決める。schema 作成は [[spec:schema-infer]]。

## 状態モデル (直交2軸)

- 軸1 ロード状態: `S0` 無選択 / `S1` config のみ / `S2` schema のみ / `S3` 両方。
- 軸2 接続レベル (config がある状態に付く): `C0` 未接続 (内容のみ・download 保存) /
  `C1` ファイル接続 (その1ファイルに save-in-place、サイドカー無) /
  `C2` プロジェクト接続 (save-in-place + `.jigtor/` + 兄弟 explorer)。

到達可能: `S0` / `S1@{C0,C1,C2}` / `S2` / `S3@{C0,C1,C2}`。

## アクション

`A1` ファイル D&D / `A2` ディレクトリ D&D / `A3` ファイル選択(picker) /
`A4` ディレクトリ選択(picker) / `A5` explorer から選択 /
`A6` schema 作成(推論) / `A7` schema 選択・クリア。

## 要件 (EARS)

- REQ-OF01: WHEN ファイルを取り込む (A1/A3) THE SYSTEM SHALL `classifyFile` で
  config/schema を判定し、対応スロットへロードして S を更新する。両スロットが埋まれば `S3`。
- REQ-OF02: WHEN ファイル単体を **D&D** した (A1) THE SYSTEM SHALL 内容を即編集可能にし
  接続を `C0` とする。ただし保存不能を黙認せず、フォルダを開く昇格導線を提示する。
- REQ-OF03: WHEN ファイルを **picker** で開いた (A3) THE SYSTEM SHALL 得られた
  `FileSystemFileHandle` を保持し、その1ファイルへの save-in-place (`C1`) を有効化する。
- REQ-OF04: WHEN ディレクトリを開く (A2/A4) THE SYSTEM SHALL プロジェクト接続 `C2` とし、
  ルートの JSON を列挙する。0件は案内して中断、1件は接続、複数件は explorer 選択 (A5) に委ねる。
- REQ-OF05: WHILE `C2` THE SYSTEM SHALL `.jigtor/schema.json` があれば自動ロードして `S3` とし、
  無ければ `S1@C2` として schema 作成/選択を推奨する。
- REQ-OF06: WHEN `C0`/`C1` からフォルダを開いて昇格する THE SYSTEM SHALL 選ばれた
  ディレクトリに同名 (必要なら同内容) のファイルが在ることを検証してから接続する
  (親一致ガード)。見つからなければ差し戻し、誤ったフォルダへ `.jigtor/` を書かない。
- REQ-OF07: `S1` から `S3` への遷移は A6 (推論) か A7 (選択) の schema アクションでのみ起きる。
  API 制約上、ファイルハンドルから親ディレクトリを自動導出してはならない (不可能)。
- REQ-OF08: `A5` explorer 選択は `C2` でのみ露出し、同一プロジェクト内で編集対象 config を切り替える。

## 検証

- `classifyFile` の config/schema 判定は [[spec:file-io]] のテストに従う。
- 状態遷移・親一致ガード・昇格ナビは `src/main.ts` の drop/picker ハンドラ上で
  目視確認 (DOM シェル)。純粋に切り出せる判定 (親一致・列挙結果の分岐) は
  core へ抽出してユニットテスト可能にする。
