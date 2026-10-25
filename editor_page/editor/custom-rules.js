/* ============================================================
   custom-rules.js — 自分用のルール置き場（構文チェック／フロー図）
   ------------------------------------------------------------
   lint.js・flow.js の「後」に読み込まれるので、ここから
     ・チェックルールの追加   … SS.addLineRule / SS.addFileRule / SS.addStmtHandler
     ・設定テーブルの書き換え … SS.HINT / SS.CMDS / SS.WRONG_WORDS / SS.DISABLE_TARGETS
     ・フロー図の見た目変更   … SS.flow.cfg / SS.flow.colors / SS.flow.stmtColors
   が行えます。組み込みのファイルは触らずに済みます。
   詳しい書き方は README.md を参照。
   ============================================================ */
(function (SS) {
'use strict';

/* ▼▼▼ ここから自分のルールを書く ▼▼▼ */



/* ▲▲▲ ここまで ▲▲▲ */


/* ------------------------------------------------------------
   サンプル集：下の ENABLE_SAMPLES を true にすると動きます。
   動作を確認したら、コピーして上の「自分のルール」欄に移し、false に戻してください。
   ------------------------------------------------------------ */
const ENABLE_SAMPLES = false;
if (!ENABLE_SAMPLES) return;

// 例1) 行ルール：1文字の変数名に注意を出す
//   ctx.text … コメント除去・^結合済みの行（前後の空白なし）
//   ctx.add('w' か 'e', メッセージ) … その行に指摘を追加
SS.addLineRule(ctx => {
  const m = ctx.text.match(/^var\s+([A-Za-z_])\b/);
  if (m) ctx.add('w', '変数名「' + m[1] + '」は短すぎます（意味が分かる名前がおすすめ）');
});

// 例2) ファイルルール：インデント0の var の二重宣言
//   ctx.lines … 全ての論理行 [{ no, ind, text }]
//   ctx.add(行番号, 'w'|'e', メッセージ)
SS.addFileRule(ctx => {
  const seen = {};
  ctx.lines.forEach(l => {
    const m = l.ind === 0 && l.text.match(/^var\s+([A-Za-z_]\w*)/);
    if (!m) return;
    if (seen[m[1]]) ctx.add(l.no, 'w', '「' + m[1] + '」は ' + seen[m[1]] + ' 行目で宣言済みです');
    else seen[m[1]] = l.no;
  });
});

// 例3) 新しいコマンドを「既知の文」にする（架空のコマンド shout）
//   true を返すと「不明な書き方です」が出なくなります
SS.CMDS.push('shout');            // 「もしかして」の候補にも入れる
SS.addStmtHandler((t, ctx) => {
  if (!/^shout\b/.test(t)) return false;
  if (!/^shout\s+\S/.test(t)) ctx.add('e', 'shout の後に文字が必要です');
  return true;
});

// 例4) 他言語のキーワードを間違いとして検出し、ヒントを出す
SS.WRONG_WORDS.push('switch');
SS.HINT.switch = 'switch はありません。「?条件」と「:?条件」を並べて書きます';

// 例5) フロー図の見た目を変える
SS.flow.stmtColors.unshift([/^(disable|enable)\b/, '#e06c75']);   // disable/enable を赤系に
SS.flow.cfg.yes = 'YES';                                          // 「はい」ラベルを変更
})(window.SS = window.SS || {});
