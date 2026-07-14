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

GitHub Release の配布ファイルをダウンロードして、そのままブラウザで開きます。
Git / Node.js / npm / Python / サーバー起動は不要です。配布 zip の `index.html` は
JS / CSS を内包した単一 HTML なので、`file://` で直接開けます。

1. GitHub の **Releases** ページで最新リリースを開く
2. **Assets** から `jigtor-vX.Y.Z.zip` をダウンロードする
   - `Source code (zip)` / `Source code (tar.gz)` ではなく、`jigtor-...zip` を選ぶ
3. ダウンロードした zip を展開する
4. 展開したフォルダを編集対象プロジェクトの `.jigtor/` に置く
5. `.jigtor/index.html` をダブルクリックする
   - ブラウザを選びたい場合は、`index.html` を Chrome / Edge / Firefox / Safari に
     ドラッグ&ドロップする

静的 web アプリなので、バックエンドはありません。読み込んだ schema / config と編集内容は
ブラウザ内だけで扱われ、外部サーバーへ送信されません。

#### ディレクトリ構造の例

たとえば `my-device/` の `config.json` を編集したい場合、導入前は jigtor 本体がまだ
手元に無く、編集対象の `config.json` だけがあります。`config.schema.json` は
持っていれば読み込めますが、最初から無くても構いません。

**導入前のディレクトリ構造**

```text
my-device/
└── config.json
```

GitHub Release から `jigtor-vX.Y.Z.zip` をダウンロードして展開し、フォルダ名を
`.jigtor` にして `my-device/` の中へ置きます。jigtor 本体、任意の schema、
バックアップなどを `.jigtor/` にまとめます。

**導入後のディレクトリ構造**

```text
my-device/
├── config.json
└── .jigtor/
    ├── index.html        ← これをブラウザで開く
    └── examples/
```

jigtor で `config.json` を読み込み、**Generate schema from config** で編集用 schema を
生成してから編集します。既に `config.schema.json` がある場合は、それも一緒に読み込めます。
編集後に **Review & save…** から保存すると、ブラウザが新しい `config.json` を
ダウンロードします。必要なら元の `config.json` をバックアップしてから、ダウンロードした
ファイルで置き換えます。

**編集後のディレクトリ構造**

```text
my-device/
├── config.json          ← 編集後の config に置き換える
└── .jigtor/
    ├── index.html
    ├── config.before.json   ← 任意: 置き換え前のバックアップ
    ├── config.schema.json   ← 任意: 生成・調整した schema を残す場合
    └── examples/
```

### 2. ファイルを読み込む

**config** を file picker かドラッグ&ドロップで読み込む。**JSON Schema** は任意です。

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

1. **保存方式** — ダウンロードのみ(現状)/ File System Access API で直接上書き /
   Tauri ネイティブラッパ。
2. **ログ・履歴** — ログ 1 枚か、バージョン管理された履歴(gzip スナップショット等)で
   復元可能にするか。
3. **schema 外フィールド** — config にあってスキーマに無いフィールド。現状は
   読み取り専用「unknown」プレースホルダで保持しているが、方針(console 出力 + 保持 /
   無視)は未確定。

## アーキテクチャ(コントリビュータ向け)

`src/core/` に純粋・UI 非依存の TypeScript(`parseSchema` → `validateConfig` →
`renderForm`、加えて `inferSchema` / `applyDefaults` / `diffConfig` / `schemaEdit`)、
`src/main.ts` は薄い DOM シェル。VCSDD で構築し、スキーマ依存グラフと敵対的レビューの
軌跡は `.vsdd/config-editor/` にあります。
