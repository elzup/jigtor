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
  THE SYSTEM SHALL 子フィールドを入れ子の `<fieldset>` (legend 付き) として描画する。
  IF その object が **root** (深さ 0) THEN THE SYSTEM SHALL fieldset/legend の囲いを
  付けず、`<div class="form-root">` の中に子を直接並べる (root の箱と `.` legend は
  常に全体を包むだけで冗長なため — ユーザー報告「root の囲いがややこしい」)。
  root object 自身へのエラー (REQ-R06) は引き続きこの div 内の errbox に収容する。
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
- REQ-R16: THE SYSTEM SHALL 検証エラーの再描画 (`refreshErrors`) を、入力コントロールを
  **再生成せず** フィールドごとの `.field-errbox` の中身だけ差し替えて行う。
  RATIONALE: 値変更のたびにフォーム全体を作り直すと、操作中の要素 (ドラッグ中の
  slider、入力中の text の caret) が破棄され「不自然」な挙動になる (ユーザー報告)。
  入力要素の identity を保つことでライブ検証と自然な操作性を両立する。

- REQ-R18: THE SYSTEM SHALL 各 leaf フィールドに位置固定の meta 行 (`.field-meta`) を
  持たせ、`refreshFieldMeta(form, baseline, current, onReset)` で**入力を再生成せず**
  中身だけ差し替える (REQ-R16 と同じ契約)。
  - THE SYSTEM SHALL 未変更時は現在値を `"key": <json>` の 1 行で表示する
    (フィールドごとのライブ値プレビュー)。
  - WHERE そのフィールドの現在値が baseline (最後に保存した値) と異なる
    THE SYSTEM SHALL 親 `.field` に `.field-dirty` を付与し、変化を**そのまま**
    `"key": <前>` → `→ "key": <後>` の 2 行で表示し、reset ボタンを添える。
    reset ボタン押下で `onReset(path)` を呼ぶ (「was」等の語や `= 値` 表記は使わない)。
  - path 同定は errbox と同じく `JSON.stringify(path)` (`['a']` と `['a','b']` を混同しない)。
  - RATIONALE: 変更フィールドの視認・変更前値の確認・ワンクリック復元 (ユーザー要望)。

- REQ-R19: THE SYSTEM SHALL text / number / textarea 入力に**ネイティブの入力制限属性**
  (`maxLength` / `pattern` / `min` / `max` / `step`) を**付けない**。
  THE SYSTEM SHALL 制約違反は入力をブロックせず、`validateConfig` (ajv) の警告として
  `.field-errbox` に出す。
  - slider (REQ-R11) の `range` は widget の性質上 min/max/step を保持するが、対の
    number 入力は無制約とし、任意値を自由に打てる経路を常に残す。
  - RATIONALE: 「入力中に制限はしない。validation error は警告で示す」方針 (ユーザー要望)。
    スキーマは検証の単一の源であり、DOM 側の重複制約が編集を妨げないようにする。
- REQ-R17: THE SYSTEM SHALL すべてのフィールド (leaf / object 問わず) のラベルに、
  そのフィールドの **ドット記法パス** を `<code class="field-path">` として付記する。
  - パスは root-anchored: `['server','port']` は `".server.port"`。
  - フォーマット `dotPath(path) = path.length ? '.' + path.join('.') : '.'`。
  - ただし root object は REQ-R04 で囲い自体を描画しないため、root の `.` タグは出さない。
    タグが付くのは leaf フィールドとネストした object。
  - RATIONALE: config のどの位置を編集しているかを、schema タブの `sub.hoge` 記法と
    一貫した見た目でフォーム上でも即座に把握できる (ユーザー要望: 全フィールドにパス表示)。
