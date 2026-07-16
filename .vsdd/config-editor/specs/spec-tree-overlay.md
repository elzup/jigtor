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

- REQ-TO01: THE SYSTEM SHALL オブジェクトの子をまず config 自身の key 順で並べる
  (ファイル順が正)。ユーザーは ↑↓ 移動で並べ替えるため、schema 順を強制しない。
  schema に統治される場合、config に無い property は末尾に missing 行として足す。
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
- REQ-TO07: object key は同じ親の中で ↑↓ 移動できる (`jsonMoveKey`)。移動は保存/diff に
  反映される (意図的な並べ替え)。schema に統治され、schema-known な key 順が schema の
  宣言順と異なる場合は、軽い警告バッジ (order ≠ schema) を出す。ファイル順自体は valid。
- REQ-TO08: 保存時は config を自身の key 順で書き出す (orderLike で元順へ戻さない)。
  reconnect 由来の偶発的な on-disk 順差は canonical 順 (ロード/保存時) を基準に diff から
  除外し、意図的な移動だけを diff に出す。
- REQ-TO09: object の「新規 key」入力は親ヘッダーの + ボタンで開閉する (常設行にしない)。
  add 行は子と同じ深さにインデントする。root は header が無いため常設。

## 検証

- `tests/treeOverlay.test.ts`: `orderedChildSlots` の present/missing/extra 分類と
  並び順の安定性 (REQ-TO01/02/03)。
- typecheck / build が通ること。DOM 反映 (REQ-TO02/05/06) は `src/main.ts` の
  Tree renderer 上で目視確認。
