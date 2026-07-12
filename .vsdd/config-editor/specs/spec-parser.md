---
id: spec:parser
title: parseSchema — JSON Schema サブセット → FieldNode ツリー
coherence:
  depends_on:
    - design:schema-model
---

# spec:parser

`parseSchema(schema: unknown): ParseResult` は JSON Schema を [[design:schema-model]] の FieldNode ツリーへ変換する。
`ParseResult = { ok: true; root: FieldNode } | { ok: false; error: string }`。

## 要件 (EARS)

- REQ-P01: WHEN schema が object でない (null / 配列 / プリミティブ)
  THE SYSTEM SHALL `{ ok: false, error }` を返す。
- REQ-P02: WHEN **ルート** schema に `type` が無い、または未対応の type
  THE SYSTEM SHALL `{ ok: false, error }` を返す (フォームを一切構築できないため明示エラー)。
  この hard error は **ルートノードのみ** に適用する。子プロパティは REQ-P10 に従う。
- REQ-P03: WHEN `type: "object"` かつ `properties` を持つ
  THE SYSTEM SHALL 各 property を子 FieldNode として再帰変換し `kind: 'object'` を返す。
- REQ-P04: WHERE property が親の `required` 配列に含まれる
  THE SYSTEM SHALL その子 FieldNode の `required` を true にする。
- REQ-P05: WHEN `type: "integer"`
  THE SYSTEM SHALL `kind: 'number'` かつ `integer: true` を返す。
  WHEN `type: "number"` THE SYSTEM SHALL `integer: false` を返す。
- REQ-P06: WHERE property が `title` を持つ
  THE SYSTEM SHALL `label` に `title` を使う。IF `title` が無い THEN THE SYSTEM SHALL キー名を label にする。
- REQ-P07: WHEN `type: "array"` かつ `items` がオブジェクトスキーマ
  THE SYSTEM SHALL `items` を再帰変換して `kind: 'array'` の `item` にする。
  IF `items` が欠落 THEN THE SYSTEM SHALL `{ ok: false, error }` を返す。
- REQ-P08: THE SYSTEM SHALL `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `default`, `description` を
  対応する型の FieldNode にコピーする。型に合わない制約 (例: string に minimum) は無視する。
- REQ-P09: IF schema が循環参照 (`$ref` による自己参照など) を含む
  THEN THE SYSTEM SHALL 無限再帰せず、未対応キーワードとして無視する (V1 は `$ref` 非対応)。
  jigtor は `$ref` を **辿らない** ため、`$ref` を含む子は type を持たず REQ-P10 の best-effort skip 対象になる。
- REQ-P10: WHEN **子プロパティ** が未対応 / 欠落 type を持つ (例: `{ $ref: '#' }`)
  THE SYSTEM SHALL 兄弟の変換を止めず、その子を `kind: 'unknown'` の
  **読み取り専用プレースホルダ** ノードとして children に含める (best-effort)。
  - `path` / `label` / `required` は通常どおり保持する。
  - RATIONALE: 単純にスキップすると、`required` な未対応子に対し validator が
    「missing required」を出しても **描画先フィールドが無く UI で解消不能** になる
    (R2 FIND-R2-002)。プレースホルダを置くことで検証エラーの描画先を確保し、
    かつ「V1 では編集不可、ファイル直接編集で対応」とユーザーに明示する。
  - エクスポートは `config` 値をそのまま保持するためデータは失われない。
  NOTE: `items` 欠落/未対応の array は convert レベルで REQ-P07 の error になるが、
  それが **子プロパティ** なら本 REQ-P10 に従い `unknown` プレースホルダになる
  (best-effort、兄弟は継続)。hard error が `parseSchema` 全体に伝播するのは
  その array が **ルート** スキーマの場合のみ (フォームを一切構築できないため)。
