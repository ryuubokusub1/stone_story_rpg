/* ============================================================
   lint.js — 構文チェック
   ------------------------------------------------------------
   読む順番の目安
     1) 設定テーブル（CMDS / HINT / DISABLE_TARGETS …）… 文字を足すだけで済む調整
     2) logicalLines … コメント除去・「^」継続行の結合 → チェック対象の「論理行」を作る
     3) lint        … 組み込みルール本体（インデント・? : の対応・各コマンド）
     4) 拡張ポイント … SS.addLineRule / SS.addFileRule / SS.addStmtHandler
        （自分のルールは custom-rules.js に書く。このファイルは触らなくてOK）
   結果は { no: 行番号, lv: 'e'(エラー) | 'w'(注意), msg: 文言 } の配列。
   ============================================================ */
(function (SS) {
'use strict';

/* ---------- 1) 設定テーブル ---------- */

// 「もしかして」候補に使うコマンド名。新コマンドを足したらここにも追加
SS.CMDS = ['activate', 'brew', 'equip', 'equipL', 'equipR', 'loadout', 'play', 'disable', 'enable', 'import', 'new', 'var', 'func', 'for', 'return'];

// 他言語の書き方を打ったときのヒント（キーは小文字）。足せば即反映
SS.HINT = {
  if: 'if は使えません。条件分岐は「?条件」で書きます（例: ?hp < 10）',
  else: 'else は使えません。「:」だけの行で書きます',
  elif: 'elif は使えません。「:?条件」で書きます',
  elseif: 'elseif は使えません。「:?条件」で書きます',
  while: 'while はありません。繰り返しは「for i = 1..5」の形です',
  function: 'function ではなく func を使います',
  def: 'def ではなく func を使います',
  let: 'let ではなく var を使います',
  const: 'const ではなく var を使います'
};
SS.ENDM = '終了記号は不要です。インデントで範囲を表します';   // HINT に無い単語（end など）用

// 「文頭にあったら間違い」の単語一覧（HINT に無いものは ENDM が出る）
SS.WRONG_WORDS = ['if', 'else', 'elif', 'elseif', 'while', 'function', 'def', 'let', 'const', 'end', 'endif', 'endfor', 'then', 'do'];

// disable / enable の後ろに置ける対象（正規表現の中身）
SS.DISABLE_TARGETS = 'abilities|banner|diagnostics|hud(\\s+\\w+)?|loadout\\s+(input|print)|npcDialog|pause|player';

/* ---------- 2) 解析：コメント除去・^ 継続行の結合・ascii ブロックの無視 ---------- */

// 行の種類。フロー図（flow.js）も同じ関数を使う
const lineKind = t => t[0] === '?' ? 'if' : t.startsWith(':?') ? 'elif' : /^:\s*$/.test(t) ? 'else'
  : /^func\b/.test(t) ? 'func' : /^for\b/.test(t) ? 'for' : 'stmt';

function logicalLines(src) {
  const out = [], carets = [];
  let inBlock = false, blockNo = 0, inAscii = false, asciiNo = 0;
  src.replace(/\r/g, '').split('\n').forEach((ln, idx) => {
    const no = idx + 1;
    if (inAscii) { if (/^\s*asciiend\s*$/.test(ln)) inAscii = false; return; }
    let res = '', i = 0;
    while (i < ln.length) {
      if (inBlock) { const e = ln.indexOf('*/', i); if (e < 0) { i = ln.length; break; } i = e + 2; inBlock = false; res += ' '; continue; }
      if (ln.startsWith('/*', i)) { inBlock = true; blockNo = no; i += 2; continue; }
      if (ln.startsWith('//', i) && ln[i - 1] !== ':') break;
      res += ln[i++];
    }
    const t = res.replace(/\s+$/, '');
    if (!t.trim()) return;
    const lead = t.match(/^[ \t]*/)[0], body = t.trim();
    if (body[0] === '^') {                       // 前の行の続き
      if (out.length) out[out.length - 1].text += ' ' + body.slice(1).trim(); else carets.push(no);
      return;
    }
    out.push({ no, ind: lead.replace(/\t/g, '  ').length, mixed: / /.test(lead) && /\t/.test(lead), text: body });
    if (/(^|[\s,=])ascii$/.test(body)) { inAscii = true; asciiNo = no; }
  });
  return { lines: out, carets, blockNo: inBlock ? blockNo : 0, asciiNo: inAscii ? asciiNo : 0 };
}

// 編集距離（「もしかして」用）
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

/* ---------- 4) 拡張ポイント（登録先） ---------- */
SS.lineRules = [];     // 論理行ごとに呼ばれる関数 (ctx) => void
SS.fileRules = [];     // 全行を見終わった後に1回呼ばれる関数 (ctx) => void
SS.stmtHandlers = [];  // 「不明な書き方」になる直前の文に呼ばれる関数 (t, ctx) => true なら既知の文として扱う
SS.addLineRule = fn => { SS.lineRules.push(fn); return fn; };
SS.addFileRule = fn => { SS.fileRules.push(fn); return fn; };
SS.addStmtHandler = fn => { SS.stmtHandlers.push(fn); return fn; };

/* ---------- 3) 構文チェック本体 ---------- */
function lint(src) {
  const D = logicalLines(src), L = D.lines, P = [];
  const add = (no, lv, msg) => P.push({ no, lv, msg });
  const failed = new Set();
  // 自作ルールが例外を出しても、全体は止めずに画面へ「注意」として出す
  const guard = (kind, idx, fn, a, b) => {
    try { return fn(a, b); } catch (e) {
      const id = kind + idx;
      if (!failed.has(id)) { failed.add(id); add(1, 'w', '[custom-rules.js] ' + kind + ' #' + (idx + 1) + ' でエラー: ' + (e && e.message || e)); }
    }
  };
  const bal = (s, no) => {
    const x = s.replace(/"[^"]*"/g, '""');
    if ((x.match(/"/g) || []).length % 2) add(no, 'e', '「"」が閉じていません');
    let a = 0, b = 0, bad = false;
    for (const ch of x.replace(/""/g, '')) {
      if (ch === '(') a++; else if (ch === ')') a--; else if (ch === '[') b++; else if (ch === ']') b--;
      if (a < 0 || b < 0) bad = true;
    }
    if (bad || a || b) add(no, 'e', 'カッコ ( ) [ ] の対応が合っていません');
  };
  D.carets.forEach(n => add(n, 'e', '「^」は前の行の続きを書く記号です。先頭の行には置けません'));
  if (D.blockNo) add(D.blockNo, 'e', 'ブロックコメント /* が閉じていません（*/ が必要です）');
  if (D.asciiNo) add(D.asciiNo, 'e', 'ascii に対応する asciiend がありません');

  // ---- 通常の文（? : func for 以外）----
  function stmtCheck(t, no) {
    if (t[0] === '>') {
      if ((t.match(/@/g) || []).length % 2) add(no, 'e', '「@」の数が奇数です（@変数名@ のように前後を囲みます）');
      const m = t.match(/^>([`ohcf])(?=[-\d@])(.*)$/);
      if (m && !/^[-\w@]+,[-\w@]+,/.test(m[2])) add(no, 'w', '「>' + m[1] + '」の後ろには X,Y, が必要です（例: >`0,1,文字）');
      return;
    }
    if (/[;{}]\s*$/.test(t)) add(no, 'w', '行末の ; { } は不要です');
    const head = (t.match(/^[A-Za-z_]\w*/) || [''])[0];
    if (/^var\b/.test(t)) {
      if (!/^var\s+[A-Za-z_]\w*(\s*=.*)?$/.test(t)) add(no, 'e', 'var の書き方: var 名前 ／ var 名前 = 値');
      else bal(t, no);
    } else if (/^(import|new)\b/.test(t)) {
      if (!/^(import|new)\s+[\w\/.]+$/.test(t)) add(no, 'e', head + ' の後にスクリプト名が必要です（例: import Rocky）');
    } else if (/^(activate|equip|equipL|equipR|loadout|brew|play)\b/.test(t)) {
      const arg = t.replace(/^\w+\s*/, '').trim();
      if (!arg) add(no, 'e', head + ' の後に引数が必要です');
      else {
        if (head === 'loadout' && !/^(\d+|@[^@]+@)$/.test(arg)) add(no, 'w', 'loadout の後ろは番号です（例: loadout 1）');
        if (head.startsWith('equip') && arg.split(/\s+/).length > 7) add(no, 'w', 'equip の検索条件は最大7個です');
      }
    } else if (/^(disable|enable)\b/.test(t)) {
      if (!new RegExp('^(disable|enable)\\s+(' + SS.DISABLE_TARGETS + ')\\s*$').test(t))
        add(no, 'w', head + ' の対象が不明です（abilities / banner / hud / pause / player など）');
    } else if (/^return\b/.test(t)) {
      bal(t, no);
    } else if (/^[A-Za-z_][\w.]*(\[[^\]]*\])*\s*(\+\+|--|=.*)$/.test(t) || /^[A-Za-z_][\w.]*\(.*\)$/.test(t)) {
      bal(t, no);
    } else {
      // 自作の「既知の文」ハンドラ。true を返すと「不明な書き方」を出さない
      const hctx = { no, text: t, head, add: (lv, msg) => add(no, lv, msg), bal: s => bal(s === undefined ? t : s, no) };
      if (SS.stmtHandlers.some((h, k) => guard('stmtHandler', k, h, t, hctx) === true)) return;
      const sug = head && SS.CMDS.map(c => [lev(head.toLowerCase(), c.toLowerCase()), c]).filter(x => x[0] <= 2).sort((a, b) => a[0] - b[0]).map(x => x[1])[0];
      add(no, 'w', '不明な書き方です' + (sug ? '（もしかして: ' + sug + '）' : ''));
    }
  }

  // ---- 1行ごとの組み込みチェック（インデント・? : の対応・各構文）----
  const chain = {}, levels = [];
  let prevOpen = false;
  function checkLine(l, i) {
    const t = l.text, d = l.ind, next = L[i + 1], no = l.no;
    if (l.mixed) add(no, 'w', 'インデントにタブと空白が混在しています');

    if (!levels.length) levels.push(d);
    else if (d > levels[levels.length - 1]) {
      if (!prevOpen) add(no, 'e', 'インデントが深すぎます（直前の行が ? :? : func for のどれでもありません）');
      levels.push(d);
    } else if (d < levels[levels.length - 1]) {
      while (levels.length > 1 && levels[levels.length - 1] > d) levels.pop();
      const top = levels[levels.length - 1];
      if (top !== d) { add(no, 'w', 'インデントが他の行と揃っていません'); if (top < d) levels.push(d); else levels[levels.length - 1] = d; }
    }

    Object.keys(chain).forEach(k => { if (+k > d) delete chain[k]; });
    let k = lineKind(t);
    if (t[0] === ':' && k === 'stmt') { add(no, 'e', '「:」の後ろに文字は書けません。else は「:」だけの行、else-if は「:?条件」です'); k = 'bad'; }
    if (k === 'elif' || k === 'else') {
      if (chain[d] !== 'if' && chain[d] !== 'elif')
        add(no, 'e', '「' + (k === 'else' ? ':' : ':?') + '」に対応する「?」がありません（同じインデントの直前に ? か :? が必要です）');
      chain[d] = k;
    } else if (k === 'if') chain[d] = 'if';
    else delete chain[d];

    const opener = ['if', 'elif', 'else', 'func', 'for'].includes(k);
    if (opener && !(next && next.ind > d)) add(no, 'w', '中身（インデントした行）がありません');
    prevOpen = opener;

    const wrongRe = new RegExp('^(' + SS.WRONG_WORDS.join('|') + ')\\b(?!\\s*[=(.\\[])', 'i');
    const mw = k === 'stmt' && t.match(wrongRe);
    if (mw) { add(no, 'e', SS.HINT[mw[1].toLowerCase()] || SS.ENDM); return; }

    if (k === 'if' || k === 'elif') {
      const c = t.slice(k === 'if' ? 1 : 2).trim();
      if (!c) { add(no, 'e', '条件が空です'); return; }
      if (/==/.test(c)) add(no, 'e', '「==」は使えません。比較は「=」です（例: ?loc = caves）');
      if (/&&|\|\|/.test(c)) add(no, 'e', '「&&」「||」は使えません。「&」「|」を使います');
      if (/!=/.test(c)) add(no, 'w', '「!=」ではなく「!」が「等しくない」です（例: ?foe ! boss）');
      if (/[&|]\s*$/.test(c)) add(no, 'e', '条件が「&」「|」で終わっています。続きは次の行の先頭に「^」を付けて書きます');
      else if (/[=<>!]\s*$/.test(c)) add(no, 'e', '条件が途中で終わっています');
      if (/^[&|]/.test(c)) add(no, 'e', '条件が「&」「|」から始まっています');
      if (/\b(and|or|not)\b/.test(c.replace(/"[^"]*"/g, ''))) add(no, 'w', 'and / or / not は使えません（& | ! を使います）');
      bal(c, no);
    } else if (k === 'func') {
      if (!/^func\s+[A-Za-z_]\w*\s*\(.*\)$/.test(t)) add(no, 'e', 'func の書き方: func 名前(引数, ...)');
    } else if (k === 'for') {
      if (!/^for\s+[A-Za-z_]\w*\s*=\s*.+\.\..+$/.test(t)) add(no, 'e', 'for の書き方: for i = 1..5');
    } else if (k === 'stmt') stmtCheck(t, no);
  }

  L.forEach((l, i) => {
    checkLine(l, i);
    // 自作の行ルール（組み込みチェックが途中で return しても必ず呼ばれる）
    if (SS.lineRules.length) {
      const ctx = {
        no: l.no, text: l.text, indent: l.ind, kind: lineKind(l.text), index: i, line: l, lines: L,
        prev: L[i - 1], next: L[i + 1],
        add: (lv, msg, at) => add(at || l.no, lv, msg),
        bal: s => bal(s === undefined ? l.text : s, l.no)
      };
      SS.lineRules.forEach((r, k) => guard('lineRule', k, r, ctx));
    }
  });

  // 自作のファイルルール（全行を見終わった後）
  if (SS.fileRules.length) {
    const fctx = {
      src, lines: L, carets: D.carets, issues: P,
      add: (no, lv, msg) => add(no, lv, msg),
      bal: (s, no) => bal(s, no)
    };
    SS.fileRules.forEach((r, k) => guard('fileRule', k, r, fctx));
  }

  return P.sort((a, b) => a.no - b.no);
}

SS.lineKind = lineKind;
SS.logicalLines = logicalLines;
SS.lev = lev;
SS.lint = lint;
})(window.SS = window.SS || {});
