---
id: spec:defaults
title: applyDefaults — 未入力フィールドを default/example で初期化
coherence:
  depends_on:
    - design:schema-model
    - spec:parser
---

# spec:defaults

`applyDefaults(root: FieldNode, config): unknown` は [[spec:parser]] の FieldNode ツリーを辿り、
config に**値が無い**フィールドを schema の `default`、無ければ `example` で埋めた**新しい config** を返す。

## 要件 (EARS)

- REQ-D01: WHEN あるフィールドの現在値が `undefined` (キー欠落) かつ `default` を持つ
  THE SYSTEM SHALL その値を `default` にする。
- REQ-D02: IF `default` が無く `example` を持つ (かつ現在値が `undefined`)
  THEN THE SYSTEM SHALL その値を `example` にする。優先順位は `default` > `example`。
- REQ-D03: WHERE フィールドに既に値が存在する (`null` / `false` / `0` / `''` を含む)
  THE SYSTEM SHALL その値を**上書きしない** (欠落=`undefined` のときだけ補完)。
- REQ-D04: WHEN object フィールドを辿る
  THE SYSTEM SHALL 子を再帰処理し、必要なら中間 object を新規生成する。
  ただし子孫すべてに補完値が無い場合、空 object を勝手に生やさない (最小変更)。
- REQ-D05: THE SYSTEM SHALL 入力 config を**破壊せず** (immutable)、新しい値を返す。
- REQ-D06: THE SYSTEM SHALL schema 外のフィールド (config にあるが FieldNode に無いキー) を保持する
  ([[spec:extra-fields]] と整合。V1 では extra-fields は別サイクルだが保持の不変条件は先に守る)。
- REQ-D07: THE SYSTEM SHALL array / unknown フィールドには default/example 補完を行わない (V1)。
