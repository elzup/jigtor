---
id: spec:validator
title: validateConfig — ajv による config 検証とフィールド別エラー
coherence:
  depends_on:
    - design:schema-model
---

# spec:validator

`validateConfig(schema, config): ValidationResult` は config を JSON Schema で検証し、
UI がフィールド横に表示できるよう **path をキーにしたエラーマップ** を返す。

```
ValidationResult = { valid: boolean; errors: FieldError[] }
FieldError = { path: string[]; message: string }
```

## 要件 (EARS)

- REQ-V01: WHEN config が全制約を満たす
  THE SYSTEM SHALL `{ valid: true, errors: [] }` を返す。
- REQ-V02: WHEN あるフィールドが制約違反 (型不一致 / range / pattern / required 欠落)
  THE SYSTEM SHALL その違反ごとに `FieldError` を 1 件返し `valid: false` にする。
- REQ-V03: THE SYSTEM SHALL ajv の `instancePath` ("/a/b/0") を FieldNode と同じ `path` 配列 (`['a','b','0']`) に正規化する。
- REQ-V04: WHEN required プロパティが欠落
  THE SYSTEM SHALL `path` を **欠落プロパティ自身** を指す配列にする (親ではなく `[...parent, missingKey]`)。
- REQ-V05: IF schema 自体が ajv でコンパイル不能
  THEN THE SYSTEM SHALL 例外を投げず `{ valid: false, errors: [{ path: [], message }] }` を返す。
- REQ-V06: THE SYSTEM SHALL 未知キーワード (`$ref` 等) を含む schema でも例外を投げない
  (ajv の strict モードを無効化する)。
