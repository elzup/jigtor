---
id: spec:tree-overlay
title: Tree overlay — schema を土台に config を並べ、変更・欠落・型を可視化
coherence:
  depends_on:
    - spec:renderer
    - spec:validator
---

# spec:tree-overlay

Tree view は元々 config インスタンスをそのまま（挿入順・実在 key のみ）描画していた。
本 spec は [[spec:renderer]] の Tree に **schema overlay** を足す。load した schema
([[spec:validator]] が使うもの) を土台に、子の並び順を安定させ、schema にあって config
に無い key を可視化し、変更された leaf をその場で示す。schema が無いときは従来通り。

純粋ロジックは `src/core/treeOverlay.ts` (`orderedChildSlots`)、schema 解決は
`src/core/schemaAt.ts` (`resolveRawSchemaAt`) に置く。DOM 反映は `src/main.ts`。

## 要件 (EARS)

- REQ-TO01: WHEN あるオブジェクトノードが `properties` を持つ schema に統治される
  THE SYSTEM SHALL その子を schema の property 宣言順に並べ、続いて config 固有
  (schema 外) の key を挿入順に並べる。これにより key の追加/削除後も表示順が安定する。
- REQ-TO02: WHEN schema の property が config オブジェクトに存在しない
  THE SYSTEM SHALL 灰色の "missing" 行を描画し、key・schema 型のチップ・追加ボタンを出す。
  追加時は schema の `default`、無ければ型のデフォルト値を挿入する。
- REQ-TO03: WHEN schema がそのオブジェクトを統治しない (schema 無し / 未記述 / 配列内 / $ref)
  THE SYSTEM SHALL config の挿入順を保持し、全 key を present として扱う (従来挙動)。
- REQ-TO04: 配列は positional。要素順はデータそのものであり overlay も並べ替えもしない。
- REQ-TO05: WHEN leaf の値がベースライン (`state.original`) と異なる
  THE SYSTEM SHALL その leaf 自身に変更マーカー (●) を付ける。親コンテナだけでなく、
  どの field が変わったかがその場で分かること。
- REQ-TO06: boolean は単一の on/off スイッチとして描画する。冗長な true/false テキスト
  フィールドを横に併置しない。スイッチのノブは実要素 (`<span>`) とし、置換要素 `<input>`
  上の擬似要素に依存しない (描画が壊れないため)。

## 検証

- `tests/treeOverlay.test.ts`: `orderedChildSlots` の present/missing/extra 分類と
  並び順の安定性 (REQ-TO01/02/03)。
- typecheck / build が通ること。DOM 反映 (REQ-TO02/05/06) は `src/main.ts` の
  Tree renderer 上で目視確認。
