---
id: spec:schema-edit
title: schema-edit — schema をフィールド行として編集する純変換
coherence:
  depends_on:
    - design:schema-model
---

# spec:schema-edit

生 JSON ではなく「フィールド行」で schema を編集するための純関数群。
行は `sub.hoge` のようなドットパスで表され、各行の type / default / validation /
required を編集できる。UI はこれらを呼ぶだけで、schema はイミュータブルに更新される。

```
SchemaRow = {
  path: string[]        // 例: ['sub','hoge']
  type: string          // 'string'|'number'|'integer'|'boolean'|'object'|'array'|'' (未設定)
  required: boolean      // 親 object の required[] に含まれるか
  default?: unknown
  description?: string
  enum?: unknown[]
  minimum?: number; maximum?: number
  minLength?: number; maxLength?: number
  pattern?: string
}
```

## 要件 (EARS)

- REQ-SE01: `flattenSchema(schema)` は object schema の全プロパティを **親→子の深さ優先順** で
  `SchemaRow[]` に平坦化する。object/array コンテナ自身も 1 行として含める。
- REQ-SE02: THE SYSTEM SHALL 各行の `required` を、その行の親 object の `required[]` 配列から決定する。
- REQ-SE03: THE SYSTEM SHALL `type` に対応する制約のみ行に載せる
  (number/integer→minimum/maximum、string→minLength/maxLength/pattern、共通→enum/default/description)。
- REQ-SE04: `editSchemaField(schema, path, patch)` は path のプロパティノードに patch を
  **イミュータブルに** マージして新 schema を返す。
  - patch の値が `undefined` のキーは schema から削除する (制約の解除)。
  - `patch.required` は特別扱い: **親の `required[]`** に対して path 末尾キーを追加/削除する。
  - 入力 schema を破壊しない。
- REQ-SE05: WHEN `editSchemaField` で `type` を変更する
  THE SYSTEM SHALL 新 type と両立しない制約 (例: string→number で minLength) を削除する。
- REQ-SE06: `addSchemaField(schema, parentPath, key, type)` は parentPath の object に
  新プロパティ `key` (指定 type) をイミュータブルに追加する。
  IF `key` が既存、または parentPath が object でない THEN THE SYSTEM SHALL 元 schema をそのまま返す (no-op)。
- REQ-SE07: `removeSchemaField(schema, path)` は path のプロパティを削除し、
  親の `required[]` からも取り除く (イミュータブル)。
- REQ-SE08: THE SYSTEM SHALL いずれの関数も例外を投げず、
  結果は必ず [[spec:parser]] で parse 可能な形を保つ (object schema のまま)。
- REQ-SE09: `sampleFromSchema(schema)` は schema に沿った **サンプル config** を生成する
  (構造化エディタ横のライブプレビュー用)。
  - 各 leaf 値の優先順位: `default` > `example`/`examples[0]` > `enum[0]` > 型プレースホルダ
    (string→`""`, number/integer→`0`, boolean→`false`, array→`[]`)。
  - object は再帰、`required` に関わらず全プロパティを埋める (プレビューなので網羅)。
  - THE SYSTEM SHALL 生成物が **その schema で valid** になるようにする
    (プレースホルダは制約を満たさない場合があるため、min/enum 等があればそれを優先。ただし
     pattern など満たせない制約は best-effort)。例外は投げない。
  - NOTE: `default` は最優先で**そのまま採用**する。作者が制約に反する `default` を
    宣言している場合、そのサンプルは invalid になりうるが、これは best-effort として許容する
    (単一の作者指定値なので enum のように代替を選べない。R11 OBS)。
