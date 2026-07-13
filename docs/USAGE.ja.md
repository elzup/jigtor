# jigtor — 実用フロー

ローカル完結・スキーマ駆動の `config.json` エディタ。実際の使い方を通しで説明し、
V1 でまだ未確定の判断事項も併記します。

> English: [`USAGE.md`](./USAGE.md)

## 実装済みフロー(いま動くもの)

```
アプリを開く ──▶ schema + config 読込 ──▶ 編集(ライブ検証) ──▶ diff 確認 ──▶ config.json 書き出し
                    │                        │                                     │
             (config だけ読んで          (未保存の変更を promote)          (localStorage に保存・
              schema を推論も可)                                            次回自動復元)
```

### 1. アプリを開く

静的 web アプリ。バックエンド無し、データはブラウザ外に出ません。

- 開発: `nr dev` → `http://jigtor.localhost`(portless 経由)
- 本番: `nr build` 後、`dist/` を任意の場所で開く/ホスト(`file://` でも可)

### 2. ファイルを読み込む

**JSON Schema** と **config** を file picker かドラッグ&ドロップで読み込む。

- schema が無い場合: config だけ読み込んで **Generate schema from config** を押すと、
  型を推論した下書きスキーマを生成(往復安全)。
- **Load example** でデモ(schema + config)を即起動して試せる。

### 3. 生成されたコントロールで編集

スキーマからフォームが生成され、型に応じた widget が出ます:

| スキーマの形 | widget |
|---|---|
| `string`(通常) | テキスト入力 |
| `string` 長文(`maxLength >= 80`) | textarea |
| `string` + `enum`(6 個以下) | ラジオボタン |
| `string` + `enum`(7 個以上) | セレクト |
| `number` / `integer` で `minimum` と `maximum` **両方**あり | スライダー + 数値入力 |
| `number` / `integer` それ以外 | 数値入力 |
| `boolean` | トグル |
| `object` | ネストした fieldset |
| `array` | 読み取り専用 JSON(編集可能な配列 UI は V2) |

- **ライブ検証**(ajv): 入力中に各フィールド脇へエラー表示。操作中の入力要素は
  作り直さないので、スライダーのドラッグやテキストのカーソルが自然なまま。
- **ドット記法パス**(`.server.port`)を全フィールドに表示。config のどこを
  編集しているか常に分かる。
- **未保存の変更を促す**: Save ボタンに `Review & save… (N)`(保留件数)を表示し、
  フッターに「まだ書き出していない」旨の注意、未保存のままタブを閉じるとブラウザの
  確認ダイアログが出る。

### 4. スキーマを調整(Schema タブ)

スキーマをフラットな `.dir.field` 行として編集 — キー / 型 / default / validation
(`min`/`max`、`minLen`/`maxLen`/`pattern`、`enum`、`required`)。現在のスキーマから
生成される有効な config の **sample JSON プレビュー**を常時表示。生スキーマ JSON は
トグルの奥に残してあります。

### 5. 確認して保存

**Review & save…** で書き出し前に **diff**(読み込み時の baseline と現在)と有効性を
表示。エクスポートは `config.json`(2 スペース字下げ)をダウンロード。**無効な状態でも
書き出し可能** — 作業を保存できずに詰まることはありません。

### 6. セッション継続

直近の schema + config を `localStorage` に保存し、次回自動復元。**Forget saved** で消去。

## 対応する JSON Schema サブセット(V1)

`type`(`object` / `string` / `number` / `integer` / `boolean` / `array`)、
`properties`、`required`、`default`、`description`、`title`、`enum`、
`minimum` / `maximum`、`minLength` / `maxLength` / `pattern`、単純な `items`。

未対応(`$ref`、`oneOf` / `anyOf` / `allOf`、条件付き、リモートスキーマ)は
グレースフルに劣化: 該当フィールドは読み取り専用プレースホルダで描画し、検証は
その参照を無視して config 全体を落とさない。

## 未確定の判断事項(V1 でまだ決めていない)

「実運用での配置」に関わる部分で、意図的に未決:

1. **ディレクトリ構成** — config/schema/log をどこに置くか(config の隣の
   `.jigtor/` フォルダ案など)、スキーマのファイル名規約
   (`schema.json` / `config.schema.json` / config 内 `$schema` フィールド)。
2. **保存方式** — ダウンロードのみ(現状)/ File System Access API で直接上書き /
   Tauri ネイティブラッパ。
3. **ログ・履歴** — ログ 1 枚か、バージョン管理された履歴(gzip スナップショット等)で
   復元可能にするか。
4. **schema 外フィールド** — config にあってスキーマに無いフィールド。現状は
   読み取り専用「unknown」プレースホルダで保持しているが、方針(console 出力 + 保持 /
   無視)は未確定。

## アーキテクチャ(コントリビュータ向け)

`src/core/` に純粋・UI 非依存の TypeScript(`parseSchema` → `validateConfig` →
`renderForm`、加えて `inferSchema` / `applyDefaults` / `diffConfig` / `schemaEdit`)、
`src/main.ts` は薄い DOM シェル。VCSDD で構築し、スキーマ依存グラフと敵対的レビューの
軌跡は `.vsdd/config-editor/` にあります。
