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
  THE SYSTEM SHALL enum を選択 UI で描画する (詳細は REQ-R15)。enum 無しなら `<input type=text>`。
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

## タイプ別リッチ widget (V1 追加)

- REQ-R11: WHEN number フィールドが `minimum` と `maximum` を**両方**持つ
  THE SYSTEM SHALL レンジスライダー (`input[type=range]`) と数値入力 (`input[type=number]`) を
  **両方**描画し、`min`/`max`/`step` を設定する (integer は `step=1`)。
  どちらを操作しても他方が同期し、`onChange(path, number)` を呼ぶ (REQ-R05 準拠)。
  IF `minimum`/`maximum` の片方でも欠ける THEN 従来どおり数値入力のみ (REQ-R02)。
- REQ-R12: WHEN string フィールドが `enum` を持たず `maxLength >= 80` (または明示 `format:'textarea'` 相当)
  THE SYSTEM SHALL `<textarea>` を描画する。それ以外の string は従来どおり `<input type=text>`。
- REQ-R13: WHEN boolean フィールドを描画する
  THE SYSTEM SHALL チェックボックスに `.toggle` クラスを付与し、トグル外観を CSS で与える
  (挙動は checkbox のまま。REQ-R03 と後方互換)。
- REQ-R14: THE SYSTEM SHALL リッチ widget でも `data-path` 属性を各コントロールに付与し、
  既存のエラー描画 (REQ-R06) と onChange (REQ-R05) の契約を維持する。
- REQ-R15: WHEN string フィールドが `enum` を持ち、選択肢が `ENUM_RADIO_MAX` (=6) 以下
  THE SYSTEM SHALL ラジオボタン群 (`input[type=radio]`) を描画する。
  - 同一フィールドの radio は同じ `name` (= path) を共有し排他選択になる。
  - 各 radio に `data-path` を付与し、選択で `onChange(path, value)` を呼ぶ (REQ-R05 準拠)。
  - 現在値に一致する radio を `checked` にする。
  IF 選択肢が `ENUM_RADIO_MAX` を超える THEN THE SYSTEM SHALL 従来どおり `<select>` を描画する。
