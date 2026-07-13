---
id: design:schema-model
title: JSON Schema subset & normalized field model
coherence:
  depends_on: []
---

# design:schema-model

jigtor V1 が扱う JSON Schema のサブセットと、パーサが出力する正規化フィールドモデルを定義する。

## 対応する JSON Schema キーワード (V1)

- `type`: `object` | `string` | `number` | `integer` | `boolean` | `array`
- `properties`, `required`, `default`, `description`, `title`
- `example` / `examples` (leaf 型のみ、`examples[0]` を採用)
- `enum`
- `minimum`, `maximum` (number/integer)
- `minLength`, `maxLength`, `pattern` (string)
- `items` (単純配列のみ)

## 先送りするキーワード (V1 では未対応・エラーにしない)

`$ref`, `oneOf`, `anyOf`, `allOf`, 条件スキーマ, リモートスキーマ。
未知キーワードは無視して parse を継続する (fail-open ではなく best-effort)。

## 正規化フィールドモデル (FieldNode)

パーサは JSON Schema を UI 中立な `FieldNode` ツリーへ変換する。

```
FieldNode =
  | { kind: 'string';  path: string[]; label: string; description?; required: boolean;
      default?: string; enum?: string[]; minLength?: number; maxLength?: number; pattern?: string }
  | { kind: 'number';  path: string[]; label: string; description?; required: boolean;
      default?: number; enum?: number[]; minimum?: number; maximum?: number; integer: boolean }
  | { kind: 'boolean'; path: string[]; label: string; description?; required: boolean; default?: boolean }
  | { kind: 'object';  path: string[]; label: string; description?; required: boolean; children: FieldNode[] }
  | { kind: 'array';   path: string[]; label: string; description?; required: boolean; item: FieldNode }
  | { kind: 'unknown'; path: string[]; label: string; description?; required: boolean; reason: string }
```

`kind: 'unknown'` は V1 で扱えない子スキーマ (例: `$ref`, `oneOf` のみ, 未対応 `type`) の
読み取り専用プレースホルダ (REQ-P10)。`reason` に未対応の理由を持つ。

## 不変条件

- THE SYSTEM SHALL `path` を root からのキー列で表現する (root は `[]`)。
- THE SYSTEM SHALL `label` を `title` があればそれ、無ければ最後のキー名から導出する。
- THE SYSTEM SHALL `required` を親 object の `required` 配列で決定する (root は false)。
