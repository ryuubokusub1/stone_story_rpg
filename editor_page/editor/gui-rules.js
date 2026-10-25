/* ============================================================
   gui-rules.js — 攻略サイトエディタの「登録（GUI）」から自動生成されるファイル
   ------------------------------------------------------------
   ・手で編集しても、攻略サイトエディタからZIPを出力するたびに上書きされます。
     手書きのルールは custom-rules.js に書いてください。
   ・読み込み順: lint → flow → gui-rules → custom-rules → ui
   ============================================================ */
(function (SS) {
'use strict';
const G = {"cmds":[],"hints":[],"targets":[],"pats":[],"colors":[],"yes":"","no":""};
const rx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 使えるコマンド：「もしかして」候補に入れ、「不明な書き方」を出さない
(G.cmds || []).forEach(c => SS.CMDS.push(c.name));
if ((G.cmds || []).length) SS.addStmtHandler((t, ctx) => {
  for (const c of G.cmds) {
    if (!new RegExp('^' + rx(c.name) + '\\b').test(t)) continue;
    if (c.arg === 'req' && !new RegExp('^' + rx(c.name) + '\\s+\\S').test(t)) ctx.add('e', c.name + ' の後に引数が必要です');
    return true;
  }
  return false;
});

// 間違い単語のヒント
(G.hints || []).forEach(h => { SS.WRONG_WORDS.push(h.word); SS.HINT[h.word.toLowerCase()] = h.msg; });

// disable / enable の対象
(G.targets || []).forEach(x => { SS.DISABLE_TARGETS += '|' + rx(x.word).replace(/\s+/g, '\\s+'); });

// 禁止パターン（行に含まれていたら指摘）
if ((G.pats || []).length) SS.addLineRule(ctx => {
  G.pats.forEach(p => {
    const hit = p.re ? new RegExp(p.pat).test(ctx.text) : ctx.text.includes(p.pat);
    if (hit) ctx.add(p.lv, p.msg);
  });
});

// フロー図：行頭の単語ごとの文字色・ラベル
(G.colors || []).slice().reverse().forEach(c => SS.flow.stmtColors.unshift([new RegExp('^' + rx(c.word) + '\\b'), c.color]));
if (G.yes) SS.flow.cfg.yes = G.yes;
if (G.no) SS.flow.cfg.no = G.no;
})(window.SS = window.SS || {});
