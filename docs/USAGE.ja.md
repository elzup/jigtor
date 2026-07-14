# jigtor — 実用フロー

ローカル完結・スキーマ駆動の `config.json` エディタ。実際の使い方を通しで説明し、
V1 でまだ未確定の判断事項も併記します。

> English: [`USAGE.md`](./USAGE.md)

## 実装済みフロー(いま動くもの)

```
アプリを開く ──▶ project folder 選択 ──▶ 編集(ライブ検証) ──▶ diff 確認 ──▶ config.json 直接保存
                    │                        │                                     │
             (config だけ読んで          (未保存の変更を promote)          (localStorage に保存・
              schema を推論も可)                                            schema/履歴も保存)
```

### 1. オンラインアプリを開く

オンラインの jigtor を Chromium 系ブラウザ(Chrome / Edge など)で開きます。
アプリは配信されますが、`config.json` の内容はサーバーへ送信しません。

1. jigtor の URL を開く
2. **Open project folder** を押す
3. `config.json` があるプロジェクトディレクトリを選ぶ
4. ブラウザの権限確認で許可する

同じディレクトリに `schema.json` または `config.schema.json` があれば自動で読み込みます。
無ければ `config.json` から schema を生成して編集できます。

#### ディレクトリ構造の例

たとえば `my-device/` の `config.json` を編集したい場合、最初は編集対象の
`config.json` だけで構いません。

**導入前のディレクトリ構造**

```text
my-device/
└── config.json
```

**Open project folder** で `my-device/` を選ぶと、jigtor が `config.json` を読みます。
保存時は同じ `config.json` を直接上書きします。

**導入後のディレクトリ構造**

```text
my-device/
└── config.json          ← jigtor が読み込む
```

編集後に **Review & save…** から保存すると、`config.json` が直接更新されます。
schema を生成・調整した場合は `schema.json`、保存履歴は `.jigtor/history.json` として
同じプロジェクト内に残せます。

**編集後のディレクトリ構造**

```text
my-device/
├── config.json          ← 直接更新される
├── schema.json          ← 任意: 生成・調整した schema
└── .jigtor/
    └── history.json     ← 任意: 保存履歴
```

### 2. ファイルを読み込む

通常は **Open project folder** でディレクトリを選ぶ。**JSON Schema** は任意です。

- schema が無い場合: config だけ読み込んで **Generate schema from config** を押すと、
  型を推論した下書きスキーマを生成(往復安全)。
- File System Access API 非対応ブラウザでは、直接上書き保存はできず download fallback になります。
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
  フッターに「まだ保存していない」旨の注意、未保存のままタブを閉じるとブラウザの
  確認ダイアログが出る。

### 4. スキーマを調整(Schema タブ)

スキーマをフラットな `.dir.field` 行として編集 — キー / 型 / default / validation
(`min`/`max`、`minLen`/`maxLen`/`pattern`、`enum`、`required`)。現在のスキーマから
生成される有効な config の **sample JSON プレビュー**を常時表示。生スキーマ JSON は
トグルの奥に残してあります。

### 5. 確認して保存

**Review & save…** で保存前に **diff**(読み込み時の baseline と現在)と有効性を
表示。保存は `config.json`(2 スペース字下げ)へ直接書き戻します。**無効な状態でも
保存可能** — 作業を保存できずに詰まることはありません。

### 6. セッション継続

直近の schema + config を `localStorage` に保存し、次回自動復元。フォルダ権限がある場合は
保存履歴を `.jigtor/history.json` にも残します。**Forget saved** でブラウザ内の復元情報を消去。

## 対応する JSON Schema サブセット(V1)

`type`(`object` / `string` / `number` / `integer` / `boolean` / `array`)、
`properties`、`required`、`default`、`description`、`title`、`enum`、
`minimum` / `maximum`、`minLength` / `maxLength` / `pattern`、単純な `items`。

未対応(`$ref`、`oneOf` / `anyOf` / `allOf`、条件付き、リモートスキーマ)は
グレースフルに劣化: 該当フィールドは読み取り専用プレースホルダで描画し、検証は
その参照を無視して config 全体を落とさない。

## 未確定の判断事項(V1 でまだ決めていない)

「実運用での配置」に関わる部分で、意図的に未決:

1. **ログ・履歴** — ログ 1 枚か、バージョン管理された履歴(gzip スナップショット等)で
   復元可能にするか。
2. **schema 外フィールド** — config にあってスキーマに無いフィールド。現状は
   読み取り専用「unknown」プレースホルダで保持しているが、方針(console 出力 + 保持 /
   無視)は未確定。

## アーキテクチャ(コントリビュータ向け)

`src/core/` に純粋・UI 非依存の TypeScript(`parseSchema` → `validateConfig` →
`renderForm`、加えて `inferSchema` / `applyDefaults` / `diffConfig` / `schemaEdit`)、
`src/main.ts` は薄い DOM シェル。VCSDD で構築し、スキーマ依存グラフと敵対的レビューの
軌跡は `.vsdd/config-editor/` にあります。
