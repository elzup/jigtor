---
id: spec:open-flow
title: open-flow — フォルダを開く単一導線とタブの状態別表示
coherence:
  depends_on:
    - spec:file-io
    - spec:schema-infer
---

# spec:open-flow

config を取り込む導線は **「Open project folder」の 1 本だけ**（drag&drop・Import・
Open schema・Load example は廃止）。入口が folder のみなので常に
`FileSystemDirectoryHandle` が得られ、`.jigtor/` サイドカーと save-in-place が
常に使える。File System Access API はファイルハンドルから親ディレクトリへ遡れない、
という以前の複雑さ（ファイル単体を落とすと親が取れない等）は本簡素化で消える。

判定は [[spec:file-io]] の `classifyFile`、schema 生成は [[spec:schema-infer]]。

## 状態

- `S0` 無選択 / `S1` config のみ / `S3` config + schema。
  （schema 単独ロードの入口を廃したため `S2` は実質発生しない。）
- 接続は常に **プロジェクト接続**（folder handle・save-in-place・`.jigtor/`）。

## 要件 (EARS)

- REQ-OF01: 取り込みの唯一の入口は「Open project folder」である。drag&drop /
  ファイル Import / 単体ファイル読み込みは提供しない。
- REQ-OF02: WHEN フォルダを開く THE SYSTEM SHALL ルートの JSON を列挙し、0 件は案内して
  中断、1 件は接続、複数件は explorer 選択に委ねる。
- REQ-OF03: WHILE 接続済み THE SYSTEM SHALL `.jigtor/schema.json` があれば自動ロードして
  `S3` とし、無ければ `S1` として schema 生成/選択を推奨する。
- REQ-OF04: `A6` schema 生成（`generateSchemaFromConfig`）は config があるとき (`S1`) のみ
  可能で、config が object でなければ拒否する。実行後 `S1 → S3` に遷移する。
- REQ-OF05: directory-picker API が無い環境 (Safari/Firefox) では唯一の入口が使えないため
  「Open project folder」を隠す。フォールバックの読み込み手段は持たない。
- REQ-OF06: タブは意味を持つ状態でのみ表示する（`tabVisible`）。Edit=config あり、
  Schema=config か schema あり（config のみのとき A6 の入口）、History=config 接続かつ
  保存履歴あり。アクティブなタブが非表示になったら表示中の先頭タブへ退避する。

## 検証

- `tabVisible` は `tests/tabVisible.test.ts`。`classifyFile` は [[spec:file-io]]。
- 列挙結果の分岐・接続・schema 自動ロードは `src/main.ts`（DOM シェル）で目視確認。
