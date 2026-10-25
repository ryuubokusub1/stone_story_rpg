/* ============================================================
   flow.js — フロー図（SVG）の生成
   ------------------------------------------------------------
   流れ:  logicalLines（lint.js）→ buildTree（木構造）→ seq / stack / rowNode（配置）→ SVG文字列
   見た目だけ変えたいときは、下の SS.flow.cfg / colors / stmtColors を書き換えるだけ。
   （custom-rules.js から書き換えてもOK。このファイルを触る必要はありません）
   ============================================================ */
(function (SS) {
'use strict';

const F = SS.flow = {
  // 寸法・文字数・ラベル
  cfg: {
    SX: 16,            // 縦の矢印を引く x 位置
    FW: 7.2,           // 半角1文字の幅(px)。全角は2文字分で計算
    LH: 16,            // 文字の行の高さ
    GAP: 22,           // ノード間の縦の間隔
    ARW: 38,           // 横方向（条件→中身）の矢印の長さ
    stmtLimit: 8,      // 連続する文がこの行数を超えたら省略
    stmtShow: 7,       // 省略時に表示する行数（残りは「… 他N行」）
    stmtCols: 40,      // 文の1行に表示する最大幅（半角換算）
    condCols: 26,      // 条件の折り返し幅（半角換算）
    condMaxLines: 3,   // 条件1区切り（&や|で分割）あたりの最大行数
    condMaxTotal: 6,   // 条件全体の最大行数
    headCols: 34,      // func / for の見出しの最大幅
    startText: '毎フレーム 上から実行',
    yes: 'はい', no: 'いいえ', elseText: 'それ以外'
  },
  // ノードの枠線の色
  colors: { if: '#c678dd', elif: '#c678dd', else: '#6b7280', for: '#56b6c2', func: '#61afef', start: '#e3a857' },
  // 文の文字色。上から順に最初に一致したものを使う： [判定の正規表現, 色]
  stmtColors: [
    [/^(equip|equipL|equipR|loadout|activate|brew|play)\b/, '#e3a857'],
    [/^>/, '#98c379']
  ],
  defaultColor: '#d9d5cc',
  // 文の表示テキストを加工したいとき用（既定はそのまま）。例: t => t.replace(/^var /, '')
  stmtText: t => t
};

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cw = s => { let w = 0; for (const c of s) w += c.charCodeAt(0) > 255 ? 2 : 1; return w; };
const cut = (s, n) => { let w = 0, o = ''; for (const c of s) { const x = c.charCodeAt(0) > 255 ? 2 : 1; if (w + x > n) return o + '…'; o += c; w += x; } return o; };
function wrap(s, n, max) {
  const o = []; let cur = '', w = 0;
  for (const c of s) { const x = c.charCodeAt(0) > 255 ? 2 : 1; if (w + x > n) { o.push(cur); cur = ''; w = 0; } cur += c; w += x; }
  if (cur) o.push(cur);
  if (o.length > max) { o.length = max; o[max - 1] = o[max - 1].slice(0, -1) + '…'; }
  return o.length ? o : [''];
}
const stmtColor = t => { for (const [re, col] of F.stmtColors) if (re.test(t)) return col; return F.defaultColor; };

/* ---------- 木構造を作る（インデントでネストを判断） ----------
   戻り値の要素:
     { t:'stmt', text, no }                         … 普通の文
     { t:'box',  k:'func'|'for', text, no, body }   … func / for とその中身
     { t:'chain', br:[ { k:'if'|'elif'|'else', cond, no, body }, … ] } … ? / :? / : のひとまとまり */
function buildTree(L) {
  let p = 0;
  function block() {
    const items = [], base = L[p].ind;
    while (p < L.length && L[p].ind >= base) {
      const l = L[p];
      if (l.ind > base) { p++; continue; }
      const k = SS.lineKind(l.text);
      if (k === 'if') {
        const c = { t: 'chain', br: [] }; let cur = l;
        for (;;) {
          p++;
          const body = (p < L.length && L[p].ind > cur.ind) ? block() : [];
          const ck = SS.lineKind(cur.text);
          c.br.push({ k: ck, cond: ck === 'else' ? '' : cur.text.slice(ck === 'if' ? 1 : 2).trim(), no: cur.no, body });
          const n = L[p];
          if (ck !== 'else' && n && n.ind === base) { const nk = SS.lineKind(n.text); if (nk === 'elif' || nk === 'else') { cur = n; continue; } }
          break;
        }
        items.push(c);
      } else if (k === 'func' || k === 'for') {
        p++;
        const body = (p < L.length && L[p].ind > l.ind) ? block() : [];
        items.push({ t: 'box', k, text: l.text, no: l.no, body });
      } else { p++; items.push({ t: 'stmt', text: l.text, no: l.no }); }
    }
    return items;
  }
  return L.length ? block() : [];
}

/* ---------- ノードの描画 ----------
   各 node は { w, h, sy(下側の矢印の出発点), mid(入口の高さ), svg } */
function nodeStmt(items) {
  const C = F.cfg;
  let ls = items.map(x => ({ t: x.text.trim(), no: x.no }));
  const extra = ls.length > C.stmtLimit ? ls.length - C.stmtShow : 0;
  if (extra) ls = ls.slice(0, C.stmtShow);
  const rows = ls.map(x => ({ c: cut(F.stmtText(x.t), C.stmtCols), no: x.no, col: stmtColor(x.t) }));
  if (extra) rows.push({ c: '… 他' + extra + '行', no: items[C.stmtShow].no, col: '#8a8f98' });
  const w = Math.max(60, Math.max(...rows.map(r => cw(r.c))) * C.FW + 20), h = rows.length * C.LH + 12;
  let s = '<rect width="' + w + '" height="' + h + '" rx="6" fill="#1e2024" stroke="#3b3f47"/>';
  rows.forEach((r, i) => s += '<text x="10" y="' + (14 + i * C.LH) + '" fill="' + r.col + '" data-no="' + r.no + '">' + esc(r.c) + '</text>');
  return { w, h, sy: h, mid: h / 2, svg: '<g class="nd" data-no="' + items[0].no + '">' + s + '</g>' };
}

function nodeHead(k, text, no) {
  const C = F.cfg, col = F.colors[k];
  let lines, w, h, s;
  if (k === 'if' || k === 'elif') {
    lines = text.replace(/\s*([&|])\s*/g, ' $1\n').split('\n').flatMap(x => wrap(x, C.condCols, C.condMaxLines)).slice(0, C.condMaxTotal);
    w = Math.max(80, Math.max(...lines.map(cw)) * C.FW + 44); h = lines.length * C.LH + 16;
    s = '<polygon points="16,0 ' + (w - 16) + ',0 ' + w + ',' + h / 2 + ' ' + (w - 16) + ',' + h + ' 16,' + h + ' 0,' + h / 2 + '" fill="#2a2440" stroke="' + col + '"/>';
  } else {
    lines = [k === 'else' ? C.elseText : cut(text, C.headCols)];
    w = Math.max(80, cw(lines[0]) * C.FW + 28); h = 26;
    s = '<rect width="' + w + '" height="' + h + '" rx="13" fill="#1e2024" stroke="' + col + '"/>';
  }
  lines.forEach((l, i) => s += '<text x="' + w / 2 + '" y="' + ((h - lines.length * C.LH) / 2 + C.LH * (i + .75)) + '" text-anchor="middle" fill="#d9d5cc">' + esc(l) + '</text>');
  return { w, h, svg: '<g class="nd"' + (no ? ' data-no="' + no + '"' : '') + '>' + s + '</g>' };
}

/* ---------- 配置（横：見出し→中身 / 縦：上から順） ---------- */
function rowNode(hd, items, label) {
  const C = F.cfg;
  if (!items.length) return { w: hd.w, h: hd.h, sy: hd.h, mid: hd.h / 2, svg: hd.svg };
  const b = seq(items), bx = hd.w + C.ARW, my = hd.h / 2;
  let s = hd.svg + '<g transform="translate(' + bx + ',0)">' + b.svg + '</g>';
  s += '<path d="M' + hd.w + ' ' + my + ' H' + (hd.w + C.ARW / 2) + ' V' + b.mid + ' H' + (bx - 1) + '" class="ln" marker-end="url(#ar)"/>';
  if (label) s += '<text x="' + (hd.w + 3) + '" y="' + (my - 4) + '" class="lb">' + label + '</text>';
  return { w: bx + b.w, h: Math.max(hd.h, b.h), sy: hd.h, mid: my, svg: s };
}

function stack(ns, label) {
  const C = F.cfg;
  if (!ns.length) return { w: 0, h: 0, sy: 0, mid: 0, svg: '' };
  let y = 0, w = 0, py = 0, s = '';
  ns.forEach((n, i) => {
    if (i) {
      const p = ns[i - 1];
      s += '<path d="M' + C.SX + ' ' + (py + p.sy) + ' V' + (y - 1) + '" class="ln" marker-end="url(#ar)"/>';
      if (label) s += '<text x="' + (C.SX + 5) + '" y="' + (y - 6) + '" class="lb">' + label + '</text>';
    }
    s += '<g transform="translate(0,' + y + ')">' + n.svg + '</g>';
    py = y; w = Math.max(w, n.w); y += n.h + C.GAP;
  });
  const last = ns[ns.length - 1];
  return { w, h: y - C.GAP, sy: py + last.sy, mid: ns[0].mid, svg: s };
}

// items（木構造の1階層）→ ノードの縦並び。ここが「どの要素をどのノードにするか」の分岐点
function seq(items) {
  const nodes = []; let buf = [];
  const flush = () => { if (buf.length) { nodes.push(nodeStmt(buf)); buf = []; } };
  items.forEach(it => {
    if (it.t === 'stmt') { buf.push(it); return; }
    flush();
    if (it.t === 'box') nodes.push(rowNode(nodeHead(it.k, it.text, it.no), it.body, ''));
    else nodes.push(stack(it.br.map(b => rowNode(nodeHead(b.k, b.cond, b.no), b.body, b.k === 'else' ? '' : F.cfg.yes)), F.cfg.no));
  });
  flush();
  return stack(nodes);
}

function flowSVG(src) {
  const L = SS.logicalLines(src).lines;
  if (!L.length) return '';
  const s0 = nodeHead('start', F.cfg.startText, 0); s0.sy = s0.h; s0.mid = s0.h / 2;
  const all = stack([s0, seq(buildTree(L))]);
  return '<svg class="flow" xmlns="http://www.w3.org/2000/svg" width="' + (all.w + 32) + '" height="' + (all.h + 32) + '">' +
    '<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#8a8f98"/></marker></defs>' +
    '<g transform="translate(16,16)">' + all.svg + '</g></svg>';
}

F.buildTree = buildTree;
SS.flowSVG = flowSVG;
})(window.SS = window.SS || {});
