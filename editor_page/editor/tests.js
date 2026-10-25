/* ============================================================
   tests.js — 構文チェックの回帰テスト（test.html で実行）
   ------------------------------------------------------------
   形式: { name: "説明", code: "チェックするコード", expect: [[行番号, "e"|"w"], ...] }
     expect が [] なら「何も指摘されないこと」を確認します。
   ルールを足したら、ここにも1件足しておくと、あとで他のルールを直したときに
   うっかり壊していないか test.html ですぐ確認できます。
   ============================================================ */
window.SS_TESTS = [
  { name: "正常: ?と:の基本", code: "?hp < 10\n  equipR vigor shield\n:\n  loadout 1", expect: [] },
  { name: "正常: :? の連鎖", code: "?a = 1\n  x = 1\n:?a = 2\n  x = 2\n:\n  x = 3", expect: [] },
  { name: "正常: ^ 継続行", code: "?a = 1 &\n^ b = 2\n  x = 1", expect: [] },
  { name: "正常: コメントのみ", code: "// コメントだけ\n/* ブロック */", expect: [] },
  { name: "正常: >表示", code: ">`0,1,HP = @hp@/@maxhp@", expect: [] },
  { name: "if/else を使った", code: "if hp < 10\n  x = 1\nelse\n  x = 2", expect: [[1,"e"],[2,"e"],[3,"e"],[4,"e"]] },
  { name: "== を使った", code: "?a == 1\n  x = 1", expect: [[1,"e"]] },
  { name: "&& || を使った", code: "?a = 1 && b = 2\n  x = 1", expect: [[1,"e"]] },
  { name: "!= を使った（注意）", code: "?a != 1\n  x = 1", expect: [[1,"w"]] },
  { name: "and/or を使った（注意）", code: "?a = 1 and b = 2\n  x = 1", expect: [[1,"w"]] },
  { name: "条件が & で終わる", code: "?a = 1 &\n  x = 1", expect: [[1,"e"]] },
  { name: "条件が空", code: "?\n  x = 1", expect: [[1,"e"]] },
  { name: "対応する ? が無い :", code: "x = 1\n:\n  y = 2", expect: [[2,"e"]] },
  { name: ": の後ろに文字", code: "?a = 1\n  x = 1\n:foo", expect: [[3,"e"]] },
  { name: "中身が無い（注意）", code: "?a = 1\n:\n  x = 1", expect: [[1,"w"]] },
  { name: "インデントが深すぎる", code: "x = 1\n  y = 2", expect: [[2,"e"]] },
  { name: "インデントが揃わない（注意）", code: "?a = 1\n    x = 1\n  y = 2", expect: [[3,"w"]] },
  { name: "タブと空白の混在（注意）", code: "?a = 1\n \tx = 1", expect: [[2,"w"]] },
  { name: "先頭行の ^", code: "^ a", expect: [[1,"e"]] },
  { name: "/* が閉じていない", code: "/* ひらきっぱなし\nx = 1", expect: [[1,"e"]] },
  { name: "ascii が閉じていない", code: "a = ascii\n  art", expect: [[1,"e"]] },
  { name: "括弧の対応", code: "var a = (1 + 2", expect: [[1,"e"]] },
  { name: "\" が閉じていない", code: "var a = \"abc", expect: [[1,"e"]] },
  { name: "var の書き方", code: "var 1a", expect: [[1,"e"]] },
  { name: "import の引数なし", code: "import", expect: [[1,"e"]] },
  { name: "equip の引数なし", code: "equipR", expect: [[1,"e"]] },
  { name: "loadout の後ろ（注意）", code: "loadout abc", expect: [[1,"w"]] },
  { name: "equip の条件が多すぎ（注意）", code: "equip a b c d e f g h", expect: [[1,"w"]] },
  { name: "disable の対象不明（注意）", code: "disable foo", expect: [[1,"w"]] },
  { name: "func の書き方", code: "func bad\n  x = 1", expect: [[1,"e"]] },
  { name: "for の書き方", code: "for i 1 5\n  x = 1", expect: [[1,"e"]] },
  { name: "行末の ; （注意）", code: "x = 1;", expect: [[1,"w"]] },
  { name: "もしかして（注意）", code: "equpR vigor", expect: [[1,"w"]] },
  { name: "@ が奇数", code: ">`0,1,HP = @hp", expect: [[1,"e"]] },
  { name: ">` の X,Y 不足（注意）", code: ">`0 text", expect: [[1,"w"]] },
  { name: "未知の他言語（let）", code: "let a = 1", expect: [[1,"e"]] },
  { name: "while", code: "while a\n  x = 1", expect: [[1,"e"],[2,"e"]] },
  { name: "end（終了記号は不要）", code: "?a = 1\n  x = 1\nend", expect: [[3,"e"]] },

  /* ▼ 自分のルール用のテストはここに追加（custom-rules.js を有効にした状態で判定されます） */
];
