/* core.js — エディタ本体（ハイライト・補完・キー操作・コピー/クリア）
   構文チェックは lint.js、フロー図は flow.js、チェック/フロー画面は ui.js */
/* ============================================================
   以下、エディタ本体
   ============================================================ */
const $ = id => document.getElementById(id);
const ed = $('ed'), hl = $('hl'), gi = $('gi'), g = $('g'), chips = $('chips'), detail = $('detail'), panel = $('panel');
const STORE = 'stone-script-editor-v1';
const SAMPLE = ['// Stone Script サンプル', 'var count = 0', '?loc.begin', '  count = 0', '?foe.hp < 10 & item.CanActivate()',
  '  equipR vigor shield', '  activate R', ':', '  loadout 1', '>`0,1,HP = @hp@/@maxhp@'].join('\n');

/* ---------- シンタックスハイライト ---------- */
const RE = /(\/\/.*|\/\*[\s\S]*?(?:\*\/|$))|(^[ \t]*>.*$)|('[^'\n]*'|"[^"\n]*")|(@[^@\n]*@)|(#[0-9a-fA-F]{3,8}\b|#[a-z]+\b)|(\b\d+(?:\.\d+)?\b)|(^[ \t]*[?:])|(\b(?:var|func|for|import|new|equipL|equipR|equip|activate|loadout|disable|enable|brew|play|true|false|null)\b)|(\b(?:ui|math|string|color|foe|item|loc|storage|screen|draw|key|music|ambient|player|summon|sys|te|time|utc|res|buffs|debuffs|ai|encounter|harvest|pickup|pos|input|event|int)\b(?=\.))|(\.[A-Za-z_]\w*)/gm;
const CLS = ['c', 'p', 's', 'i', 'col', 'n', 'q', 'k', 'ns', 'm'];
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function highlight(src) {
  let out = '', last = 0, m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    if (m[0] === '') { RE.lastIndex++; continue; }
    out += esc(src.slice(last, m.index));
    const cls = CLS[m.slice(1).findIndex(x => x !== undefined)];
    let t = esc(m[0]);
    if (cls === 'p') t = t.replace(/@[^@\n]*@/g, x => '<span class="i">' + x + '</span>');
    out += '<span class="' + cls + '">' + t + '</span>';
    last = RE.lastIndex;
  }
  return out + esc(src.slice(last));
}

/* ---------- 描画（ハイライト・行番号・スクロール同期） ---------- */
let lineCount = 0;
function render() {
  const v = ed.value;
  hl.innerHTML = highlight(v) + '\n ';
  const n = v.split('\n').length;
  if (n !== lineCount) { lineCount = n; gi.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); }
  sync(); status();
}
function sync() {
  hl.style.transform = 'translate(' + (-ed.scrollLeft) + 'px,' + (-ed.scrollTop) + 'px)';
  gi.style.transform = 'translateY(' + (-ed.scrollTop) + 'px)';
}
function status() {
  const l = ed.value.slice(0, ed.selectionStart).split('\n');
  $('st').textContent = 'Ln ' + l.length + ', Col ' + (l[l.length - 1].length + 1);
}

/* ---------- 補完 ---------- */
let cands = [], active = 0, dismissed = false, lastK = '', lastPT = 'mouse';
const WORD = /([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]*)*)$/;

function queryAtCursor() {
  const left = ed.value.slice(0, ed.selectionStart);
  const ls = left.lastIndexOf('\n') + 1, line = left.slice(ls);
  const im = line.match(/^[ \t]*(import[ \t]+[\w\/]*)$/);           // import Games/Sn... のように空白込みで検索
  if (im) return { q: im[1].replace(/\s+/, ' '), start: ls + line.length - im[1].length };
  const m = left.match(WORD);
  if (m) return { q: m[1], start: left.length - m[1].length };
  if (/(^|[^\/])\/$/.test(left)) return { q: '/', start: left.length };
  return { q: '', start: left.length };
}
function filterSnips(q) {
  if (!q) return [];
  const ql = q.toLowerCase(), dot = q.lastIndexOf('.'), after = q.slice(dot + 1).toLowerCase();
  return snippets.filter(s => {
    const k = s.key.toLowerCase();
    if (k.startsWith('.')) return dot >= 0 && k.slice(1).startsWith(after);
    if (k.startsWith('/')) return q === '/';
    return k.startsWith(ql);
  }).slice(0, 60);
}
function rangeFor(s) {
  const pos = ed.selectionStart, left = ed.value.slice(0, pos);
  if (s.key.startsWith('/')) return [pos, pos];                      // 入力済みの / は残して続きを挿入
  if (s.key.startsWith('.')) return [left.lastIndexOf('.') + 1, pos];
  return [queryAtCursor().start, pos];
}
const KIND = { fn: '関数', prop: '値', enemy: '敵ID', filter: 'フィルタ', import: 'import', item: 'アイテムID', comment: 'コメント' };
function info(s) {
  const d = s.desc || '', first = d.split('\n')[0].trim();
  let kind = 'prop';
  if (d.includes('敵のID')) kind = 'enemy';
  else if (d.includes('検索フィルタ')) kind = 'filter';
  else if (d.includes('importで')) kind = 'import';
  else if (d.includes('GetCooldown()の中')) kind = 'item';
  else if (s.key.startsWith('/')) kind = 'comment';
  else if (typeof s.insert === 'string' && s.insert.includes('(')) kind = 'fn';
  const ret = (first.match(/^戻り値:\s*(.+)$/) || [])[1];
  let sub = ret ? '→ ' + ret : '';
  if (kind === 'enemy' || kind === 'filter') sub = first;
  if (kind === 'item') sub = typeof s.insert === 'string' ? s.insert : '';
  if (kind === 'comment') sub = first;
  return { kind, sub, ret };
}
function drawChips() {
  chips.innerHTML = '';
  if (!cands.length) { chips.innerHTML = '<span class="none">入力すると候補が出ます</span>'; return; }
  cands.forEach((s, i) => {
    const { kind, sub } = info(s);
    const b = document.createElement('button');
    b.className = 'chip ' + kind + (i === active ? ' on' : '');
    b.dataset.i = i;
    b.innerHTML = '<span>' + esc(s.key.trim()) + '</span>' + (sub ? '<i>' + esc(sub) + '</i>' : '');
    chips.appendChild(b);
  });
  chips.scrollLeft = 0; chips.scrollTop = 0;
}
function drawDetail() {
  const s = cands[active];
  if (!s) { detail.innerHTML = '<p class="ret">候補をタップすると説明が表示されます。もう一度タップ（または「挿入」）で入力されます。</p>'; return; }
  const { kind, ret } = info(s);
  const lines = (s.desc || '').replace(/^\s+/, '').split('\n');
  const bl = lines.findIndex(l => l.trim() === '');
  const head = bl < 0 ? lines : lines.slice(0, bl);
  let code = bl < 0 ? '' : lines.slice(bl + 1).join('\n').replace(/^ /, '');
  const text = head.filter((l, i) => !(i === 0 && /^戻り値:/.test(l))).join('\n');
  const ins = typeof s.insert === 'function' ? s.insert() : (s.insert || s.key);
  detail.innerHTML =
    '<div class="dh ' + kind + '"><span class="badge">' + KIND[kind] + '</span><b>' + esc(s.key.trim()) + '</b>' +
    (ret ? '<span class="ret">→ ' + esc(ret) + '</span>' : '') + '<button id="ins">挿入</button></div>' +
    (text ? '<p>' + esc(text) + '</p>' : '') +
    (code.trim() ? '<pre class="ex">' + highlight(code) + '</pre>' : '') +
    '<div class="ins">挿入内容: ' + esc(ins.replace(/\$1/g, '▮').replace(/\n/g, ' ⏎ ')) + '</div>';
}
function setActive(i) {
  active = i;
  chips.querySelectorAll('.chip').forEach((c, j) => c.classList.toggle('on', j === i));
  drawDetail();
}
function refresh() {
  lastK = ed.selectionStart + ':' + ed.value.length;
  cands = dismissed ? [] : filterSnips(queryAtCursor().q);
  active = 0; drawChips(); drawDetail();
}

/* ---------- 入力操作 ---------- */
function typeText(t) {
  ed.focus();
  if (!document.execCommand('insertText', false, t)) {              // 失敗時のみフォールバック（undo履歴は途切れる）
    ed.setRangeText(t, ed.selectionStart, ed.selectionEnd, 'end');
    onInput();
  }
}
function insertSnippet(s) {
  if (!s) return;
  const [a, b] = rangeFor(s);
  let t = typeof s.insert === 'function' ? s.insert() : (s.insert || s.key);
  let off = t.indexOf('$1');
  if (off >= 0) t = t.replace('$1', ''); else off = t.length;
  ed.focus(); ed.setSelectionRange(a, b);
  typeText(t);
  ed.setSelectionRange(a + off, a + off);
  status(); refresh();
}
function indent(dir) {
  const v = ed.value, a = ed.selectionStart, b = ed.selectionEnd;
  if (dir > 0 && a === b) { typeText('  '); return; }
  const ls = v.lastIndexOf('\n', a - 1) + 1;
  let le = v.indexOf('\n', b); if (le < 0) le = v.length;
  const block = v.slice(ls, le);
  const out = block.split('\n').map(l => dir > 0 ? '  ' + l : l.replace(/^ {1,2}|^\t/, '')).join('\n');
  ed.focus(); ed.setSelectionRange(ls, le); typeText(out);
  if (a === b) { const p = Math.max(ls, a - (block.length - out.length)); ed.setSelectionRange(p, p); }
  else ed.setSelectionRange(ls, ls + out.length);
}

let saveTimer;
function onInput() {
  dismissed = false; render(); refresh();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, ed.value); } catch (e) {} }, 400);
}
ed.addEventListener('input', onInput);
ed.addEventListener('scroll', sync, { passive: true });
document.addEventListener('selectionchange', () => {
  if (document.activeElement !== ed) return;
  status();
  if (ed.selectionStart + ':' + ed.value.length !== lastK) refresh();
});

ed.addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!e.shiftKey && cands.length && queryAtCursor().q) insertSnippet(cands[active]);
    else indent(e.shiftKey ? -1 : 1);
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {  // オートインデント
    const v = ed.value, pos = ed.selectionStart, ls = v.lastIndexOf('\n', pos - 1) + 1, line = v.slice(ls, pos);
    let ind = line.match(/^[ \t]*/)[0];
    if (/^\s*(\?|:\s*$|func\b|for\b)/.test(line)) ind += '  ';
    e.preventDefault(); typeText('\n' + ind); return;
  }
  if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && cands.length) {
    e.preventDefault();
    setActive((active + (e.key === 'ArrowDown' ? 1 : cands.length - 1)) % cands.length);
    const c = chips.children[active]; if (c) c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  if (e.key === 'Escape') { dismissed = true; refresh(); }
});

/* ---------- パネル・キーバー操作 ---------- */
document.addEventListener('pointerdown', e => { lastPT = e.pointerType; });
[panel, $('keys')].forEach(el => el.addEventListener('mousedown', e => e.preventDefault()));  // PCでフォーカスを奪わない
chips.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  const i = +b.dataset.i;
  if (lastPT === 'mouse' || i === active) insertSnippet(cands[i]); else setActive(i);  // タッチは1回目=説明、2回目=挿入
});
chips.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse') return;
  const b = e.target.closest('.chip'); if (b && +b.dataset.i !== active) setActive(+b.dataset.i);
});
detail.addEventListener('click', e => { if (e.target.closest('#ins')) insertSnippet(cands[active]); });
$('keys').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'tab') indent(1);
  else if (a === 'untab') indent(-1);
  else if (a === 'undo') { ed.focus(); document.execCommand('undo'); }
  else if (a === 'redo') { ed.focus(); document.execCommand('redo'); }
  else if (a === 'info') panel.classList.toggle('collapsed');
  else if (a === 'done') ed.blur();
  else if (b.dataset.t) {
    typeText(b.dataset.t);
    if (b.dataset.b) { const p = ed.selectionStart - 1; ed.setSelectionRange(p, p); }
  }
});

/* ---------- コピー / クリア ---------- */
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 1400); }
$('bcopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(ed.value); }
  catch (e) { ed.select(); document.execCommand('copy'); }
  toast('コピーしました');
});
$('bclr').addEventListener('click', () => {
  if (!ed.value || !confirm('エディタの内容をすべて消しますか？')) return;
  ed.value = ''; onInput();
});

/* ---------- iPhone：キーボード表示時のレイアウト追従 ---------- */
function fit() {
  const v = window.visualViewport; if (!v) return;
  document.body.style.setProperty('--vh', v.height + 'px');
  document.body.style.transform = 'translateY(' + v.offsetTop + 'px)';
  document.body.classList.toggle('kb', innerHeight - v.height > 120);
}
if (window.visualViewport) { visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); fit(); }
if (innerHeight < 700) panel.classList.add('collapsed');

/* ---------- サイトから渡されたコード（URLの #code=...） ---------- */
function loadHandoff() {
  const m = location.hash.match(/^#code=(.*)$/); if (!m) return;
  let code = null;
  try { code = decodeURIComponent(m[1]); } catch (e) {}
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  if (code === null || code === ed.value) return;
  if (ed.value.trim() && !confirm('サイトのサンプルコードを読み込みます。\n今のエディタの内容は上書きされます。よろしいですか？')) return;
  ed.value = code;
  try { localStorage.setItem(STORE, code); } catch (e) {}
}

/* ---------- 起動 ---------- */
try { ed.value = localStorage.getItem(STORE) ?? SAMPLE; } catch (e) { ed.value = SAMPLE; }
loadHandoff();
render(); refresh();
