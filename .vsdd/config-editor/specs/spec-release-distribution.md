---
id: spec:release-distribution
title: release-distribution — hosted app と config.json 直接保存
coherence:
  depends_on:
    - spec:file-io
    - spec:schema-infer
---

# spec:release-distribution

オンライン Web アプリとして配信し、File System Access API で `config.json` を直接保存する
利用者向け導線を定義する。

## 要件 (EARS)

- REQ-RD01: THE SYSTEM SHALL 利用者がオンライン URL を開くだけで jigtor を起動できる
  hosted Web app として配信する。
- REQ-RD02: WHEN 利用者が `Open project folder` で編集対象ディレクトリを選ぶ
  THE SYSTEM SHALL そのディレクトリ内の `config.json` を読み込み、保存時に同じ
  `config.json` を直接上書きする。
- REQ-RD03: WHEN 同じディレクトリに `schema.json` または `config.schema.json` が存在する
  THE SYSTEM SHALL それを schema として読み込む。
- REQ-RD04: WHEN 利用者が schema を持っていない
  THE SYSTEM SHALL `config.json` だけを読み込み、`Generate schema from config` で編集用 schema を生成できる。
- REQ-RD05: WHEN 利用者が保存する
  THE SYSTEM SHALL 現在の schema を `schema.json` として、保存履歴を `.jigtor/history.json`
  として同じプロジェクトディレクトリ配下に書ける。
- REQ-RD06: THE SYSTEM SHALL config / schema の内容をアプリ配信サーバーへ送信しない。
  読み書きは File System Access API を通じてブラウザ内で完結する。
- REQ-RD07: IF File System Access API が利用できないブラウザで開かれた
  THEN THE SYSTEM SHALL 直接上書き保存ができないことを明示し、download fallback に限定する。

## 非要件

- V1 では Rust launcher / Tauri wrapper は要求しない。
- V1 では GitHub Release zip を主要導線にしない。
