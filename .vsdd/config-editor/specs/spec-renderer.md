---
id: spec:renderer
title: renderForm — FieldNode ツリーから DOM フォームを描画
coherence:
  depends_on:
    - spec:parser
    - spec:validator
---

# spec:renderer

`renderForm(root: FieldNode, value, onChange): HTMLElement` は [[spec:parser]] の FieldNode から
入力コントロールを生成し、[[spec:validator]] のエラーをフィールド横に表示する。

## 要件 (EARS)

- REQ-R01: WHEN `kind: 'string'` かつ `enum` あり
  THE SYSTEM SHALL `<select>` を描画する。enum 無しなら `<input type=text>`。
- REQ-R02: WHEN `kind: 'number'`
  THE SYSTEM SHALL `<input type=number>` を描画し、`integer` なら `step=1` を設定する。
- REQ-R03: WHEN `kind: 'boolean'`
  THE SYSTEM SHALL `<input type=checkbox>` を描画する。
- REQ-R04: WHEN `kind: 'object'`
  THE SYSTEM SHALL 子フィールドを入れ子の `<fieldset>` として描画する。
- REQ-R05: WHEN ユーザーが入力値を変更する
  THE SYSTEM SHALL `path` と新しい値で `onChange(path, value)` を呼ぶ。
- REQ-R06: WHERE FieldNode に対応する `FieldError` が存在
  THE SYSTEM SHALL そのコントロール直後にエラーメッセージ要素 (`.field-error`) を描画する。
- REQ-R07: WHERE `required` が true
  THE SYSTEM SHALL ラベルに必須マーカー (`*`) を付与する。
- REQ-R08: WHERE `description` が存在
  THE SYSTEM SHALL 説明テキストをコントロール近傍に描画する。
- REQ-R09: IF ある `FieldError` の `path` が **どの描画済みフィールドにも一致しない**
  (例: `required` だが `properties` に無いキー、`config` にしか無い余剰キー)
  THEN THE SYSTEM SHALL そのエラーをフォーム末尾の `.form-errors` サマリに
  `path` 付きで描画する。これによりいかなる検証エラーも UI から不可視にならない
  (R4 FIND-R4-001 が示した「描画先が無く解消不能」クラスを恒久的に閉じる)。
