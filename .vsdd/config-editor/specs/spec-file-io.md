---
id: spec:file-io
title: file-io — config/schema の読み込みとエクスポート (純粋関数)
coherence:
  depends_on:
    - design:schema-model
---

# spec:file-io

ファイル選択・DnD の副作用は UI 層に置き、テキスト⇔値の変換のみ純粋関数で提供する。

```
parseJsonFile(text: string): { ok: true; value: unknown } | { ok: false; error: string }
serializeConfig(value: unknown): string          // 2-space indent + 末尾改行
classifyFile(name: string, value): 'schema' | 'config' | 'unknown'
```

## 要件 (EARS)

- REQ-F01: WHEN text が妥当な JSON
  THE SYSTEM SHALL `{ ok: true, value }` を返す。
- REQ-F02: IF text が不正な JSON
  THEN THE SYSTEM SHALL 例外を投げず `{ ok: false, error }` を返す (エラーは行情報を含めてよい)。
- REQ-F03: THE SYSTEM SHALL `serializeConfig` で 2 スペースインデント + 末尾に単一改行を付与する。
- REQ-F04: THE SYSTEM SHALL `serializeConfig(parseJsonFile(t).value)` が
  意味的に等価な JSON を返す (round-trip でキー/値が保存される)。
- REQ-F05: WHEN ファイル名が `*.schema.json` または JSON に `$schema` / `properties` が存在
  THE SYSTEM SHALL `classifyFile` で `'schema'` を返す。
- REQ-F06: WHEN ファイル名が `config.json` かつ schema 特徴を持たない
  THE SYSTEM SHALL `'config'` を返す。それ以外の判別不能は `'unknown'`。
