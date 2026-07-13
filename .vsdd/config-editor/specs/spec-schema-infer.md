---
id: spec:schema-infer
title: inferSchema — 既存 config からドラフト JSON Schema を推論
coherence:
  depends_on:
    - design:schema-model
---

# spec:schema-infer

`inferSchema(config: unknown): JsonSchema` は schema を持たない既存 config から、
[[design:schema-model]] のサブセットに収まる**ドラフト JSON Schema** を推論する。
出力はそのまま [[spec:parser]] に通せる普通の JSON Schema オブジェクトで、ユーザーが調整できる。

## 要件 (EARS)

- REQ-I01: WHEN config がプレーン object
  THE SYSTEM SHALL `{ type: 'object', properties: {...}, required: [] }` を返す。
  `required` は 1 サンプルから断定できないため**空**にする (ユーザーが後で調整)。
- REQ-I02: THE SYSTEM SHALL 各値の型を次で推論する:
  string→`{type:'string'}`, boolean→`{type:'boolean'}`,
  整数の number→`{type:'integer'}`, 非整数 number→`{type:'number'}`, object→再帰。
  array の `items` は **全要素が同一の単純プリミティブ (string / boolean / number)** の
  ときだけ付与する (number は全整数なら `integer`)。混在・object 要素・入れ子配列は
  `items` を付けず `{type:'array'}` に留める。
  RATIONALE: 先頭要素だけから items を決めると `[0, false]` のような混在配列で
  **生成した schema が生成元 config を弾く**(round-trip 不変条件違反、PROP-I01 が検出)。
  V1 は配列 UI が read-only なので item 型推論の価値は低く、安全側に倒す。
- REQ-I03: WHERE leaf 値 (string/number/integer/boolean) を推論する
  THE SYSTEM SHALL 観測値を `examples: [value]` として付与する ([[spec:defaults]] と初期化で連携)。
- REQ-I04: WHEN 空配列 `[]`
  THE SYSTEM SHALL `{ type: 'array' }` (items 無し) を返す。
  NOTE: これは [[spec:parser]] の REQ-P07 で child なら `unknown` プレースホルダになる (許容)。
- REQ-I05: WHEN `null` 値
  THE SYSTEM SHALL 型を決められないため `{}` (空スキーマ = 制約なし) を返す。
- REQ-I06: THE SYSTEM SHALL 入力を破壊しない (immutable)。
- REQ-I07: IF config が object でない (プリミティブ / 配列 / null)
  THEN THE SYSTEM SHALL その値単体を推論した schema を返す (ルートが object でなくてもよい)。
  ただし [[spec:parser]] のルートは object を要求するため、UI 側は object config を主対象とする。
