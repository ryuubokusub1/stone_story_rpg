/* ============================================================
   ui.js — 「✓」ボタン／チェック一覧／フロー図の画面／行番号の色付け
   ------------------------------------------------------------
   core.js が作る $ ed gi esc sync status を使います（読み込み順: core → lint → flow → custom-rules → ui）。
   ルールや図の中身を変えたいときは lint.js / flow.js / custom-rules.js を触る。ここは画面まわり専用。
   ============================================================ */
(function () {
const SS = window.SS;
const nav = $('keys');
nav.insertAdjacentHTML('afterbegin', '<button id="blint" class="ok">✓</button><button id="bflow">フロー</button>');
document.body.insertAdjacentHTML('beforeend',
  '<div id="ov" hidden><div class="ovh"><button data-tab="lint">チェック</button><button data-tab="flow">フロー図</button><span class="sp"></span><button id="ovx">✕ 閉じる</button></div><div id="ovb"></div></div>');

let ovTab = 'lint', issues = [], lintTimer;

function paintGutter() {
  const n = ed.value.split('\n').length, m = {};
  issues.forEach(x => { if (m[x.no] !== 'e') m[x.no] = x.lv; });
  gi.innerHTML = Array.from({ length: n }, (_, i) => m[i + 1] ? '<span class="g' + m[i + 1] + '">' + (i + 1) + '</span>' : (i + 1)).join('\n');
}
function runLint() {
  issues = SS.lint(ed.value);
  const e = issues.filter(x => x.lv === 'e').length, w = issues.length - e, b = $('blint');
  b.textContent = e ? '✖' + e : w ? '⚠' + w : '✓';
  b.className = e ? 'er' : w ? 'wr' : 'ok';
  paintGutter();
  if (!$('ov').hidden) drawOv();
}
function drawOv() {
  document.querySelectorAll('.ovh [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === ovTab));
  const box = $('ovb');
  if (ovTab === 'lint') {
    const lines = ed.value.split('\n');
    box.innerHTML = (issues.length
      ? issues.map(x => '<button class="is ' + x.lv + '" data-no="' + x.no + '"><b>' + (x.lv === 'e' ? '✖ エラー' : '⚠ 注意') + '　' + x.no + '行目</b><span>' + esc(x.msg) + '</span><code>' + esc((lines[x.no - 1] || '').trim().slice(0, 60)) + '</code></button>').join('')
      : '<p class="okm">✓ 問題は見つかりませんでした</p>') +
      '<p class="note">簡易チェックです。ゲーム本体の判定と完全には一致しません。タップでその行へ移動します。</p>';
  } else {
    let svg = '';
    try { svg = SS.flowSVG(ed.value); }
    catch (err) { box.innerHTML = '<p class="note">フロー図の生成でエラー: ' + esc(err && err.message || err) + '</p>'; return; }
    box.innerHTML = svg ? '<p class="note">上から順に毎フレーム実行されます。ノードをタップするとその行へ移動します。</p>' + svg : '<p class="note">スクリプトが空です</p>';
  }
}
function openOv(tab) { ovTab = tab; ed.blur(); $('ov').hidden = false; drawOv(); }
function closeOv() { $('ov').hidden = true; }
function jump(no) {
  const lines = ed.value.split('\n'); let off = 0;
  for (let i = 0; i < no - 1 && i < lines.length; i++) off += lines[i].length + 1;
  closeOv(); ed.focus(); ed.setSelectionRange(off, off + (lines[no - 1] || '').length);
  ed.scrollTop = Math.max(0, (no - 4) * 24); sync(); status();
}

$('blint').addEventListener('click', () => openOv('lint'));
$('bflow').addEventListener('click', () => openOv('flow'));
$('ovx').addEventListener('click', closeOv);
$('ov').addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) { ovTab = t.dataset.tab; drawOv(); return; }
  const n = e.target.closest('[data-no]');
  if (n) jump(+n.dataset.no);
});
ed.addEventListener('input', () => { clearTimeout(lintTimer); lintTimer = setTimeout(runLint, 350); });
runLint();
window.__t = { lint: SS.lint, flowSVG: SS.flowSVG };   // ブラウザのコンソールから __t.lint('...') で試せる
})();
