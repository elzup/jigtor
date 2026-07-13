---
id: spec:changelog
title: diffConfig — 読込時原本と編集後の差分
coherence:
  depends_on:
    - design:schema-model
---

# spec:changelog

`diffConfig(before, after): Change[]` は 2 つの JSON 値を比較し、保存前の確認や
変更ログ (次サイクルの履歴) に使える **path 単位の変更リスト** を返す。

```
Change = { path: string[]; before: unknown; after: unknown; kind: 'added' | 'removed' | 'changed' }
```

## 要件 (EARS)

- REQ-CL01: WHEN before と after が意味的に等価
  THE SYSTEM SHALL `[]` を返す。
- REQ-CL02: WHEN あるパスの値が両方に存在し等価でない
  THE SYSTEM SHALL `{ kind: 'changed', before, after }` を 1 件返す。
- REQ-CL03: WHEN あるキーが after にのみ存在 (before で undefined)
  THE SYSTEM SHALL `{ kind: 'added', before: undefined, after }` を返す。
- REQ-CL04: WHEN あるキーが before にのみ存在 (after で undefined)
  THE SYSTEM SHALL `{ kind: 'removed', before, after: undefined }` を返す。
- REQ-CL05: WHEN 両方の値がプレーン object
  THE SYSTEM SHALL キーの和集合を再帰比較し、各 `Change.path` を root からの完全パスにする。
- REQ-CL06: THE SYSTEM SHALL 配列は**まるごと 1 値**として比較する (要素単位で分解しない)。
  等価でなければ配列パスに `changed` を 1 件。
- REQ-CL07: THE SYSTEM SHALL 入力を破壊せず、任意の JSON 値で例外を投げない。
- REQ-CL08: THE SYSTEM SHALL 出力順を決定的にする (path の辞書順)。
- REQ-CL09: THE SYSTEM SHALL 変更が無いパスを結果に含めない (等価なキーは出さない)。
