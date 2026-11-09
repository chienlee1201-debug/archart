/* ============================================================
   artists.js — 找畫家（artists.html）
   · 看畫家／看作品（?view=works）兩種檢視，資料來自 ArchDB.getCatalog()（一次讀完，篩選都在瀏覽器做）
   · 搜尋與篩選（資料讀好才啟用表單）：
       看畫家：關鍵字比對畫家名字、一句話介紹、標籤、作品名稱；
               媒材＝至少一件作品是這個媒材；價格＝至少一件作品的價格區間和選的區間有重疊；客製＝custom_ok
       看作品：關鍵字比對作品名稱、畫家名字、畫家標籤；
               媒材＝這件作品的媒材；價格＝這件作品的區間有重疊；客製＝這位畫家 custom_ok
       關鍵字忽略大小寫、全形半形、前後空白；用空白隔開多個詞＝每個詞都要有。打字停 0.25 秒後自動篩選
       沒有價格（或非賣品）的作品，選了價格條件就不算符合
   · 排序：推薦＝畫家 sort_order → created_at、作品依畫家順序 → position（資料庫給的順序）；
           最新加入＝created_at 新到舊；價格低到高／高到低（畫家用他作品的最低價／最高價；沒有價格的排最後）
   · 條件寫進網址：?view=works&q=貓&medium=油畫&price=0-5000&custom=1&sort=new（沒選的不寫）
       重新整理、分享連結都會保留；切換「看畫家／看作品」也保留。網址值不在選單裡就當沒選
       網址帶 #search（頁首的搜尋圖示）時，載入後游標直接放在搜尋框
   · 風格選單先藏起來（畫家標籤是自由文字，對不上固定選項），網址的 style 參數目前不理會
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards;
  if(!C || !window.ArchDB) return;

  var params = new URLSearchParams(location.search);
  var view = params.get("view") === "works" ? "works" : "artists";
  var grids = {
    artists: document.querySelector('[data-view="artists"]'),
    works: document.querySelector('[data-view="works"]')
  };
  var count = document.querySelector('[data-slot="count"]');
  var unit = document.querySelector('[data-slot="unit"]');
  var live = document.querySelector('[data-slot="live"]');
  var form = document.getElementById("search");
  var ctl = {
    q: document.getElementById("f-q"),
    medium: document.getElementById("f-medium"),
    price: document.getElementById("f-price"),
    custom: document.getElementById("f-custom"),
    sort: document.getElementById("f-sort")
  };
  var clearTop = document.querySelector('[data-action="clear"]');
  if(!grids.artists || !grids.works || !form || !ctl.q || !ctl.medium || !ctl.price || !ctl.custom || !ctl.sort) return;

  var UNIT = view === "works" ? "件作品" : "位畫家";
  var NOUN = view === "works" ? "作品" : "畫家";

  /* 切換檢視：分段按鈕、顯示哪一個格線、標題 */
  grids.artists.hidden = view !== "artists";
  grids.works.hidden = view !== "works";
  Array.prototype.forEach.call(document.querySelectorAll("[data-seg]"), function(a){
    if(a.getAttribute("data-seg") === view) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
  unit.textContent = UNIT;
  if(view === "works") document.title = "看作品・找畫家｜Arch";

  var grid = grids[view];
  var gridClass = grid.className;   // 沒有結果時拿掉格線樣式，有結果再放回來

  /* ---------- 篩選條件：從網址讀進來（只接受選單裡有的值） ---------- */
  function optionValues(sel){
    return Array.prototype.map.call(sel.options, function(o){ return o.value; });
  }
  function pick(sel, v){
    v = v == null ? "" : String(v);
    return optionValues(sel).indexOf(v) >= 0 ? v : "";
  }
  var state = {
    q: String(params.get("q") || "").slice(0, 100),
    medium: pick(ctl.medium, params.get("medium")),
    price: pick(ctl.price, params.get("price")),
    custom: params.get("custom") === "1",
    sort: pick(ctl.sort, params.get("sort"))
  };
  ctl.q.value = state.q;
  ctl.medium.value = state.medium;
  ctl.price.value = state.price;
  ctl.custom.checked = state.custom;
  ctl.sort.value = state.sort;

  function hasFilter(){ return !!(norm(state.q) || state.medium || state.price || state.custom); }

  /* 條件 → 網址參數（view 另外給） */
  function queryString(v){
    var p = new URLSearchParams();
    if(v === "works") p.set("view", "works");
    if(state.q.trim()) p.set("q", state.q.trim());
    if(state.medium) p.set("medium", state.medium);
    if(state.price) p.set("price", state.price);
    if(state.custom) p.set("custom", "1");
    if(state.sort) p.set("sort", state.sort);
    var s = p.toString();
    return s ? "?" + s : "";
  }
  /* 更新網址（不新增上一頁紀錄）＋讓「看畫家／看作品」帶著目前的條件 */
  function syncUrl(){
    try{ history.replaceState(null, "", location.pathname + queryString(view) + location.hash); }catch(e){}
    Array.prototype.forEach.call(document.querySelectorAll("[data-seg]"), function(a){
      a.setAttribute("href", "artists.html" + queryString(a.getAttribute("data-seg")));
    });
  }

  /* ---------- 比對用的工具 ---------- */
  /* 關鍵字正規化：全形轉半形（NFKC）、小寫、空白合併、去頭尾 */
  function norm(s){
    s = String(s == null ? "" : s);
    if(s.normalize) s = s.normalize("NFKC");
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }
  function terms(){
    var s = norm(state.q);
    return s ? s.split(" ") : [];
  }
  function hay(parts){ return norm(parts.filter(Boolean).join("\n")); }

  /* 作品價格區間 [低, 高]；沒有價格或非賣品回傳 null */
  function workRange(w){
    if(w.status === "not_for_sale" || !(w.price_min > 0)) return null;
    return [Number(w.price_min), w.price_max > w.price_min ? Number(w.price_max) : Number(w.price_min)];
  }
  /* 選單的價格區間，例如 "0-5000"、"30000-"（沒寫上限＝不限） */
  function pickedRange(){
    if(!state.price) return null;
    var p = state.price.split("-");
    var lo = Number(p[0]) || 0, hi = p[1] === "" || p[1] == null ? Infinity : Number(p[1]);
    return [lo, hi];
  }
  function overlap(r, want){ return !!r && r[0] <= want[1] && r[1] >= want[0]; }

  function time(x){ var t = Date.parse(x && x.created_at); return isNaN(t) ? 0 : t; }

  /* ---------- 每一筆資料先整理好：比對文字、價格、原本順序、卡片（卡片只做一次，重排時沿用） ---------- */
  var items = [];

  function prepArtists(artists){
    return artists.map(function(a, i){
      var ranges = (a.works || []).map(workRange).filter(Boolean);
      return {
        i: i, data: a,
        text: hay([a.name, a.tagline, (a.tags || []).join(" ")].concat((a.works || []).map(function(w){ return w.title; }))),
        mediums: (a.works || []).map(function(w){ return w.medium; }),
        ranges: ranges,
        low: ranges.length ? Math.min.apply(null, ranges.map(function(r){ return r[0]; })) : null,
        high: ranges.length ? Math.max.apply(null, ranges.map(function(r){ return r[1]; })) : null,
        custom: !!a.custom_ok,
        time: time(a),
        node: null
      };
    });
  }
  function prepWorks(works){
    return works.map(function(w, i){
      var a = w.artist || {};
      var r = workRange(w);
      return {
        i: i, data: w,
        text: hay([w.title, a.name, (a.tags || []).join(" ")]),
        mediums: [w.medium],
        ranges: r ? [r] : [],
        low: r ? r[0] : null,
        high: r ? r[1] : null,
        custom: !!a.custom_ok,
        time: time(w),
        node: null
      };
    });
  }

  function matches(it, words, want){
    for(var k = 0; k < words.length; k++){ if(it.text.indexOf(words[k]) < 0) return false; }
    if(state.medium && it.mediums.indexOf(state.medium) < 0) return false;
    if(want && !it.ranges.some(function(r){ return overlap(r, want); })) return false;
    if(state.custom && !it.custom) return false;
    return true;
  }

  /* 排序；同分時維持推薦順序。沒有價格的一律排最後 */
  function sorter(){
    var s = state.sort;
    if(s === "new") return function(a, b){ return (b.time - a.time) || (a.i - b.i); };
    if(s === "price-asc" || s === "price-desc"){
      var key = s === "price-asc" ? "low" : "high", dir = s === "price-asc" ? 1 : -1;
      return function(a, b){
        var x = a[key], y = b[key];
        if(x == null && y == null) return a.i - b.i;
        if(x == null) return 1;
        if(y == null) return -1;
        return ((x - y) * dir) || (a.i - b.i);
      };
    }
    return function(a, b){ return a.i - b.i; };
  }

  function card(it){
    if(!it.node) it.node = view === "works" ? C.workCard(it.data, { showArtist: true }) : C.artistCard(it.data);
    return it.node;
  }

  /* ---------- 畫出結果 ---------- */
  function render(announce){
    var words = terms(), want = pickedRange();
    var list = items.filter(function(it){ return matches(it, words, want); }).sort(sorter());
    count.textContent = String(list.length);
    if(clearTop) clearTop.hidden = !hasFilter();

    if(!list.length){
      grid.className = "";
      var btn = C.el("button", { class: "btn btn--ghost btn--sm", text: "清除篩選", attrs: { type: "button" } });
      btn.addEventListener("click", function(){ clearFilters(true); });
      C.fill(grid, C.emptyBox("沒有符合條件的" + NOUN + "。換個關鍵字，或放寬篩選條件試試看。", btn));
    }else{
      grid.className = gridClass;
      C.fill(grid, list.map(card));
    }
    syncUrl();
    if(announce !== false){
      live.textContent = list.length ? "找到 " + list.length + " " + UNIT + "。" : "沒有符合條件的" + NOUN + "。";
    }
  }

  function clearFilters(focusSearch){
    state.q = ""; state.medium = ""; state.price = ""; state.custom = false;
    ctl.q.value = ""; ctl.medium.value = ""; ctl.price.value = ""; ctl.custom.checked = false;
    clearTimeout(timer);
    render();
    if(focusSearch) ctl.q.focus();
  }

  /* ---------- 表單事件 ---------- */
  var timer = null;
  function onType(){
    clearTimeout(timer);
    timer = setTimeout(function(){
      if(state.q === ctl.q.value) return;
      state.q = ctl.q.value;
      render();
    }, 250);
  }

  function bind(){
    ctl.q.addEventListener("input", onType);
    ctl.q.addEventListener("search", onType);   // Safari／Chrome 搜尋框右邊的「×」
    ctl.medium.addEventListener("change", function(){ state.medium = ctl.medium.value; render(); });
    ctl.price.addEventListener("change", function(){ state.price = ctl.price.value; render(); });
    ctl.custom.addEventListener("change", function(){ state.custom = ctl.custom.checked; render(); });
    ctl.sort.addEventListener("change", function(){ state.sort = ctl.sort.value; render(); });
    /* 按 Enter／手機鍵盤的「搜尋」：不重新載入頁面，立刻篩選並收起鍵盤 */
    form.addEventListener("submit", function(e){
      e.preventDefault();
      clearTimeout(timer);
      state.q = ctl.q.value;
      render();
      if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    if(clearTop) clearTop.addEventListener("click", function(){ clearFilters(true); });
  }

  function enable(on){
    [ctl.q, ctl.medium, ctl.price, ctl.custom, ctl.sort].forEach(function(c){ c.disabled = !on; });
  }

  syncUrl();   // 先讓「看畫家／看作品」帶上網址裡的條件

  window.ArchDB.getCatalog().then(function(cat){
    var raw = view === "works" ? cat.works : cat.artists;
    if(!raw.length){
      count.textContent = "0";
      grid.className = "";
      C.fill(grid, C.emptyBox(view === "works" ? "目前還沒有上架的作品，過幾天再來看看。" : "目前還沒有上架的畫家，過幾天再來看看。"));
      live.textContent = "目前沒有資料。";
      return;
    }
    items = view === "works" ? prepWorks(raw) : prepArtists(raw);
    enable(true);
    bind();
    render(false);
    var n = Number(count.textContent);
    live.textContent = !hasFilter() ? "已載入 " + raw.length + " " + UNIT + "。"
      : n ? "已載入，符合條件的有 " + n + " " + UNIT + "。"
      : "已載入，沒有符合條件的" + NOUN + "。";
    if(location.hash === "#search"){
      try{ ctl.q.focus({ preventScroll: true }); }catch(e){ ctl.q.focus(); }
    }
  }).catch(function(err){
    count.textContent = "0";
    grid.className = "";
    C.fill(grid, C.errorBox(err));
    live.textContent = "";
  });
})();
