# Stone Script Editor 改修ガイド

構文チェック・フロー図を **自分で追加・修正する** ための手引きです。
（攻略サイトエディタからダウンロードした ZIP の `editor/` フォルダにこのファイルが入っています）

- 公式マニュアル: https://stonestoryrpg.com/stonescript/manual.html
- 組み込みのチェックは「簡易チェック」です。ゲーム本体の判定と完全には一致しません。食い違いを見つけたら、このガイドの方法でルールを直してください。

---

## 1. ファイル構成

| ファイル | 役割 | 触る頻度 |
|---|---|---|
| `index.html` | 画面の骨組み。`<script>` の**読み込み順**がここで決まる | ほぼ無し |
| `editor.css` | 見た目（色・サイズ・チェック画面） | 見た目を変えるとき |
| `snippets.js` | 補完候補（`const snippets = [...]`）。**このファイルだけ差し替えればOK** | スニペット更新時 |
| `core.js` | エディタ本体（ハイライト・補完・キー操作・コピー/クリア） | ほぼ無し |
| `lint.js` | **構文チェック**（解析＋組み込みルール＋拡張ポイント） | ルールを根本から直すとき |
| `flow.js` | **フロー図**（木構造化→配置→SVG。見た目の設定テーブル付き） | 図の構造を変えるとき |
| `gui-snippets.js` / `gui-rules.js` | **攻略サイトエディタの「登録（GUI）」から自動生成**（手で編集しても次回の出力で上書き） | 触らない |
| `custom-rules.js` | **自分用のルール置き場**（lint.js / flow.js の後に読み込まれる） | **いちばんよく触る** |
| `ui.js` | 「✓」ボタン・チェック一覧・フロー図の画面・行番号の色付け | 画面を変えるとき |
| `tests.js` / `test.html` | 構文チェックの回帰テスト（`test.html` をブラウザで開くだけ） | ルールを足したとき |

読み込み順（`index.html`）: `snippets → gui-snippets → core → lint → flow → gui-rules → custom-rules → ui`
`custom-rules.js` が `lint.js` / `flow.js` より前だと `SS` が無くてエラーになります。

> **基本方針**: まず `custom-rules.js` に書く。それで足りないときだけ `lint.js` / `flow.js` を直接直す。
> こうしておくと、将来エディタ本体を差し替えても自分のルールが残ります。

---

## 2. 仕組み（全体の流れ）

```
 テキスト
   │  logicalLines()   … コメント除去 / 「^」継続行の結合 / ascii〜asciiend を無視
   ▼
 論理行  [{ no, ind, mixed, text }, ...]
   │
   ├─ lint()      … 1行ずつ checkLine → 自作の行ルール → 最後に自作のファイルルール
   │     └→ 指摘 [{ no, lv:'e'|'w', msg }, ...] → ui.js が ✖/⚠ ボタンと一覧、行番号の色に反映
   │
   └─ flowSVG()   … buildTree(木構造) → seq / stack / rowNode(配置) → SVG文字列 → ui.js が表示
```

**論理行**（ルールが受け取る行）の中身:

| 項目 | 内容 |
|---|---|
| `no` | 元テキストの行番号（1始まり）。指摘はこの番号で表示される |
| `ind` | インデント幅（タブは空白2個として数える） |
| `mixed` | インデントにタブと空白が混在しているか |
| `text` | コメント除去済み・前後の空白なし。`^` で続けた行は半角スペースで1行に結合済み |

`lineKind(text)` が行の種類を返します: `'if'`（`?…`）/ `'elif'`（`:?…`）/ `'else'`（`:` だけ）/ `'func'` / `'for'` / `'stmt'`（それ以外）

---

## 3. やりたいこと → 触る場所

| やりたいこと | 方法 | 場所 |
|---|---|---|
| 他言語の書き方（`switch` など）にヒントを出したい | `WRONG_WORDS` に単語、`HINT` に文言を追加 | `custom-rules.js` |
| 新しいコマンドを「不明な書き方」にしたくない | `addStmtHandler`（§4-C） | `custom-rules.js` |
| 「もしかして」候補にコマンドを足したい | `SS.CMDS.push('名前')` | `custom-rules.js` |
| `disable` / `enable` の対象を増やしたい | `SS.DISABLE_TARGETS` に `\|対象` を足す | `custom-rules.js` |
| 独自のチェックを足したい（1行単位） | `addLineRule`（§4-A） | `custom-rules.js` |
| 独自のチェックを足したい（ファイル全体） | `addFileRule`（§4-B） | `custom-rules.js` |
| 既存ルールの文言を直したい | `lint.js` の該当行を検索して書き換え | `lint.js` |
| 新しいブロック構文を追加したい | §5 | `lint.js` + `flow.js` |
| フロー図の色・文字数・ラベルを変えたい | §6 | `custom-rules.js` |

---

## 4. 構文チェックにルールを足す

指摘は `'e'`（エラー・赤）か `'w'`（注意・黄）。ボタンの数字・行番号の色・一覧に反映されます。

### A. 行ルール（1行ごとに呼ばれる）

```js
SS.addLineRule(ctx => {
  const m = ctx.text.match(/^var\s+([A-Za-z_])\b/);
  if (m) ctx.add('w', '変数名「' + m[1] + '」は短すぎます');
});
```

`ctx` の中身:

| 名前 | 内容 |
|---|---|
| `ctx.text` / `ctx.no` / `ctx.indent` | 行のテキスト / 行番号 / インデント幅 |
| `ctx.kind` | `'if'` `'elif'` `'else'` `'func'` `'for'` `'stmt'` |
| `ctx.prev` / `ctx.next` | 前後の論理行（無ければ `undefined`） |
| `ctx.lines` / `ctx.index` | 全論理行 / 自分の位置 |
| `ctx.add(lv, msg)` | この行に指摘を追加（第3引数に行番号を渡すと別の行にも付けられる） |
| `ctx.bal(文字列)` | 引用符・カッコの対応チェック（省略時はこの行全体） |

組み込みチェックが途中で終わった行（`if` を使った間違い行など）でも、行ルールは**必ず呼ばれます**。
`ctx.kind === 'stmt'` で「通常の文だけ」に絞るのがコツです。

### B. ファイルルール（全行を見終わってから1回）

```js
SS.addFileRule(ctx => {
  const seen = {};
  ctx.lines.forEach(l => {
    const m = l.ind === 0 && l.text.match(/^var\s+([A-Za-z_]\w*)/);
    if (!m) return;
    if (seen[m[1]]) ctx.add(l.no, 'w', '「' + m[1] + '」は ' + seen[m[1]] + ' 行目で宣言済みです');
    else seen[m[1]] = l.no;
  });
});
```

`ctx.lines`（論理行）, `ctx.src`（元のテキスト）, `ctx.issues`（ここまでの指摘）, `ctx.add(行番号, lv, msg)`, `ctx.bal(文字列, 行番号)`

「呼ばれているのに宣言されていない関数」「`import` が先頭にない」など、**行をまたぐチェック**はこちらです。

### C. 文ハンドラ（新コマンドを「既知」にする）

通常の文でどの書き方にも当てはまらないと「不明な書き方です」が出ます。
ハンドラが `true` を返すと、その文は「既知」とみなされ、警告が出なくなります。

```js
SS.CMDS.push('shout');                       // 「もしかして」の候補にも入れる
SS.addStmtHandler((t, ctx) => {              // t = 文のテキスト
  if (!/^shout\b/.test(t)) return false;     // 自分の担当でなければ false
  if (!/^shout\s+\S/.test(t)) ctx.add('e', 'shout の後に文字が必要です');
  return true;
});
```

### D. 設定テーブルを書き換える（コードを書かずに済む調整）

```js
SS.WRONG_WORDS.push('switch');                              // 文頭に来たら間違い
SS.HINT.switch = 'switch はありません。「?」と「:?」で書きます';  // 出すメッセージ（キーは小文字）
SS.DISABLE_TARGETS += '|newTarget';                         // disable/enable の対象を追加
```

### 書くときの注意

- **コメントや `^` は処理済み**です。`ctx.text` にコメントは残っていません。コメントそのものを検査したいときは `ctx.src`（ファイルルール）から元の行を読みます。
- **行番号は元の行**です（空行・コメント行も数えた番号）。`ascii` 〜 `asciiend` の中身は論理行に含まれません。
- 正規表現は**行頭 `^` と行末 `$`** で固定すると誤検出が減ります。
- 自作ルールが例外を出しても、エディタは止まりません。チェック一覧の1行目に `[custom-rules.js] … でエラー` と出るので、メッセージを見て直してください。
- 誤検出（正しいコードに警告）は `'e'` より `'w'` にしておくと安全です。

---

## 5. 新しいブロック構文を追加する（例: `while 条件`）

`?` `:?` `:` `func` `for` のように「次の行以降をインデントして中身を書く」構文が増えたときの手順です。

1. **`lint.js` の `lineKind`** に種類を追加
   ```js
   : /^while\b/.test(t) ? 'while'
   ```
2. **`lint.js` の `checkLine`**
   - `const opener = [...]` の配列に `'while'` を足す（中身が無い警告・インデント深すぎ判定に効く）
   - 書き方チェックの分岐に追加:
     ```js
     } else if (k === 'while') {
       if (!/^while\s+.+$/.test(t)) add(no, 'e', 'while の書き方: while 条件');
     ```
   - `WRONG_WORDS` と `HINT` から `while` を消す（もう間違いではないので）
3. **`flow.js` の `buildTree`** の `k === 'func' || k === 'for'` に `|| k === 'while'`
4. **`flow.js` の `colors`** に `while: '#xxxxxx'`（枠線の色。無いと色が未指定になる）
5. `tests.js` にケースを足して `test.html` で確認

分岐のように「条件が真/偽で2方向に分かれる図」にしたい場合は、`buildTree` の `chain` と `seq` の
`it.t === 'chain'` の分岐を参考に、新しい `t:` の種類を作ります。

---

## 6. フロー図の見た目を変える

`custom-rules.js`（または `flow.js` の先頭）で設定します。

```js
SS.flow.cfg.yes = 'YES';              // 「はい」ラベル
SS.flow.cfg.stmtCols = 50;            // 文を何文字まで表示するか（半角換算）
SS.flow.cfg.stmtLimit = 12;           // 連続する文が何行を超えたら省略するか
SS.flow.cfg.stmtShow = 10;            // 省略するとき何行見せるか
SS.flow.colors.func = '#ff9900';      // ノード枠線の色（if / elif / else / for / func / start）
SS.flow.stmtColors.unshift([/^(disable|enable)\b/, '#e06c75']);   // 文の色（上から最初に一致したもの）
SS.flow.stmtText = t => t.replace(/^var\s+/, '');                 // 表示テキストの加工
```

主な設定値（`SS.flow.cfg`）: `GAP`（縦の間隔）/ `ARW`（横の矢印の長さ）/ `condCols`（条件の折り返し幅）/
`condMaxLines`（条件の最大行数）/ `headCols`（func・for 見出しの幅）/ `startText`（開始ノードの文言）/ `no`（「いいえ」）/ `elseText`

---

## 7. 動作確認の方法

### test.html（おすすめ・iPhone でもOK）
`editor/test.html` を開くと、`tests.js` の全ケースを実行して ✓ / ✗ を表示します。
- 上部の「組み込みのみで試す」で、`custom-rules.js` を外した状態も確認できます。
- ページ下部の欄に1行書いて「チェック」を押すと、その場で指摘を確認できます。
- ルールを足したら `tests.js` にケースを1件足す → あとで別のルールを直しても壊れていないか一目で分かります。

形式: `{ name: "説明", code: "テキスト", expect: [[行番号, 'e'|'w'], ...] }`（`[]` は「指摘なし」を期待）

### ブラウザのコンソール（PC）
エディタを開いて `__t.lint('?a == 1\n  x')` や `__t.flowSVG('...')` を実行できます。

### サンプルで動作を見る
`custom-rules.js` の `ENABLE_SAMPLES` を `true` にすると、サンプルルールが有効になります（試したら `false` に戻す）。

---

## 8. つまずいたとき

| 症状 | 原因・対処 |
|---|---|
| 直したのに反映されない（特に iPhone） | ブラウザのキャッシュ。`index.html` の `<script src="lint.js?v=2">` のように数字を変える／タブを閉じて開き直す |
| 画面が真っ白・ボタンが出ない | どれかの `.js` に構文エラー。`test.html` を開くと原因が分かりやすい／カッコの閉じ忘れを確認 |
| `SS is not defined` | `custom-rules.js` が `lint.js` より前に読み込まれている。`index.html` の順序を確認 |
| 自作ルールで警告が1行目に出る | `[custom-rules.js] … でエラー` はルール内の例外。メッセージの内容を修正 |
| 正しいコードに警告が出る | 誤検出。`WRONG_WORDS` / 正規表現を直すか、そのルールを `'w'` に下げる |
| フロー図のノードがずれる | 文字幅の計算は `FW`（半角1文字=7.2px）の概算。極端に長い行は `stmtCols` を調整 |

---

## 9. スニペット（補完候補）を更新する

- `snippets.js` の `const snippets = [...]` を丸ごと差し替えれば反映されます。
- 攻略サイトエディタの「snippets.js を読込」、または「Script Editor のファイル」欄で直接編集すると、ZIP を出力するたびに同梱されます。
- 1件の形式: `{ key: ".名前", insert: "名前($1)", desc: " 戻り値:型\n説明\n\n サンプルコード" }`
  `$1` は挿入後のカーソル位置、`insert` は関数にもできます（日付付きコメントの例を参照）。

---

## 10. 攻略サイトエディタ側で、記事とエディタをまとめて編集・保存する

### GUI で登録する（コードを書かない方法）
攻略サイトエディタの「Script Editor の登録（GUI）」に入力するだけで、次のものを追加できます。

| 項目 | できること |
|---|---|
| 単語・スニペットを登録 | 補完候補を追加（キー・挿入内容・戻り値・説明・サンプルコード） |
| 使えるコマンド（単語） | 「不明な書き方です」を出さない／「もしかして」候補に入れる（引数の必須チェック付き） |
| 間違い単語のヒント | 行頭にあったらエラーにして、好きなメッセージを出す |
| 禁止パターン | 行に含まれていたら指摘（テキスト or 正規表現、エラー/注意を選べる） |
| disable / enable の対象 | 使える対象の言葉を追加 |
| フロー図の文の色・ラベル | 行頭の単語ごとの文字色、「はい/いいえ」ラベル |

入力内容は `gui-snippets.js` と `gui-rules.js` として自動生成され、ZIP に入ります。
複雑な判定（行をまたぐチェックなど）が必要なときだけ、§4 の `custom-rules.js` を使ってください。

### ファイルを直接編集する（上級者向け）

攻略サイトエディタの下部「Script Editor のファイル」欄から、この `editor/` 内の全ファイル
（`snippets.js` / `custom-rules.js` / `lint.js` / `flow.js` / `core.js` / `ui.js` / `editor.css` など）を直接編集できます。

- 右側の **「Script Editor（試用）」** で、編集内容が反映されたエディタをその場で操作できます（構文エラーは欄の下に表示）。
- 変更したファイルには選択欄で「●」が付きます。「このファイルを初期値に戻す」で元に戻せます。
- **プロジェクト保存**: 記事＋エディタ側の変更を `stone-guide-project.json` に保存。**プロジェクト読込**で丸ごと復元します。
- ZIP の直下にも `project.json` が入るので、展開したフォルダからでも読み込めます（公開したくない場合は、公開前に削除してください）。
- ZIP を展開して手で直したファイルは、「Script Editor のファイル」欄に貼り付けて取り込んでください（そうしないと次回の ZIP で元に戻ります）。
