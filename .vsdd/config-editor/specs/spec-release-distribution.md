---
id: spec:release-distribution
title: release-distribution — GitHub Release artifact と .jigtor 配置
coherence:
  depends_on:
    - spec:file-io
    - spec:schema-infer
---

# spec:release-distribution

GitHub Release で配る利用者向け artifact と、編集対象プロジェクト内での配置規約を定義する。

## 要件 (EARS)

- REQ-RD01: THE SYSTEM SHALL GitHub Release asset として、source archive とは別に
  利用者向け zip (`jigtor-vX.Y.Z.zip`) を提供する。
- REQ-RD02: THE SYSTEM SHALL Release zip 展開後の `index.html` を `file://` で直接開ける形にする。
  つまり `index.html` は実行に必要な JS / CSS を内包し、外部 asset module の読み込みに依存しない。
- REQ-RD03: THE SYSTEM SHALL 編集対象プロジェクト直下の `.jigtor/` に jigtor 本体と
  任意の schema / backup をまとめて置ける配置を標準導線として説明する。
- REQ-RD04: WHEN 利用者が schema を持っていない
  THE SYSTEM SHALL `config.json` だけを読み込み、`Generate schema from config` で編集用 schema を生成できる。
- REQ-RD05: THE SYSTEM SHALL ブラウザ外へ config / schema を送信しない。読み込みは file picker /
  drag-and-drop、書き出しはブラウザ download とする。

## 非要件

- V1 では File System Access API による元ファイルの直接上書きは要求しない。
- V1 では Rust launcher / Tauri wrapper は要求しない。
