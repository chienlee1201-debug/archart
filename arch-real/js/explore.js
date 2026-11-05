/* ============================================================
   explore.js — 作品探索頁（explore.html）
   · 桌機／平板：隨機 10 幅，依真實尺寸比例（同一個比例尺 px/cm）排成一面展覽牆，剛好放滿一個畫面
   · 手機（639px 以下）：一次一幅，往左滑隨機下一幅、往右滑回上一幅
   ============================================================ */
(function(){
  "use strict";

  /* ---------- 資料 ----------
     從資料庫讀已上架畫家的作品（ArchDB.getCatalog()，走 public_works 檢視表），只留有寬、高的作品。
     欄位：id、title、artist（name / slug）、medium、support、width_cm、height_cm、
     status（available 可購買／sold 已售出／not_for_sale 非賣品）、image_url；
     沒有圖片時用 ph（作品色塊佔位）代替 */
  function getWorks(){
    return window.ArchDB.getCatalog().then(function(cat){
      return cat.works.filter(function(w){ return Number(w.width_cm) > 0 && Number(w.height_cm) > 0; }).map(function(w, i){
        return {
          id: w.id,
          title: (w.title && String(w.title).trim()) || "未命名作品",
          artist: { name: w.artist.name, slug: w.artist.slug },
          medium: w.medium, support: w.support,
          width_cm: Number(w.width_cm), height_cm: Number(w.height_cm),
          status: w.status, image_url: w.image_url || null,
          ph: "ph--" + (i % 6 + 1)
        };
      });
    });
  }

  var STATUS_LABEL = { sold:"已售出", not_for_sale:"非賣品" };
  var WALL_COUNT = 10;
  var MIN_SHORT_DESKTOP = 60;   // 小畫短邊至少 60px
  var MIN_SHORT_MOBILE = 72;

  var body = document.getElementById("ex-body");
  var scaleBox = document.getElementById("ex-scale");
  var scaleBar = document.getElementById("ex-scale-bar");
  var scaleTxt = document.getElementById("ex-scale-txt");
  var hint = document.getElementById("ex-hint");
  var prevBtn = document.getElementById("ex-prev");
  var nextBtn = document.getElementById("ex-next");
  var nextTxt = document.getElementById("ex-next-txt");
  var live = document.getElementById("ex-live");
  if(!body || !nextBtn) return;

  var mqMobile = window.matchMedia("(max-width:639px)");
  var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var works = [], byId = {};
  var mode = "";             // "wall" | "single"
  var wallSet = [];          // 目前牆上的作品
  var wallEl = null;

  /* ---------- 小工具 ---------- */
  function esc(v){
    return String(v == null ? "" : v).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function shuffle(a, rand){
    rand = rand || Math.random;
    a = a.slice();
    for(var i = a.length - 1; i > 0; i--){ var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  /* 固定種子的亂數：同一批作品、同樣的牆面大小，每次排出來都一樣（縮放視窗時不會亂跳） */
  function seeded(str){
    var h = 2166136261;
    for(var i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function(){ h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  function fmtCm(n){ return String(Math.round(n * 10) / 10); }
  function sizeText(w){ return fmtCm(w.width_cm) + " × " + fmtCm(w.height_cm) + " cm"; }
  function label(w){
    var s = "〈" + w.title + "〉" + w.artist.name + " · " + sizeText(w);
    if(STATUS_LABEL[w.status]) s += "（" + STATUS_LABEL[w.status] + "）";
    return s;
  }
  function artHTML(w){
    var inner = w.image_url
      ? '<img src="' + esc(w.image_url) + '" alt="" loading="lazy" decoding="async" draggable="false">'
      : '<span class="ph ' + esc(w.ph || "") + '"></span>';
    var tag = STATUS_LABEL[w.status] ? '<span class="status ex-status">' + STATUS_LABEL[w.status] + "</span>" : "";
    return '<span class="ex-art">' + inner + "</span>" + tag;
  }
  /* 依真實尺寸換成畫面大小；短邊小於下限時只放大這一幅（維持長寬比） */
  function sizeAt(w, s, minShort){
    var pw = w.width_cm * s, ph = w.height_cm * s, short = Math.min(pw, ph);
    if(short < minShort){ var k = minShort / short; pw *= k; ph *= k; }
    return { w:pw, h:ph };
  }
  /* 比例尺：挑一個整數長度，讓線長在 60–160px 之間 */
  function showScale(s){
    var nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500], pick = nice[0];
    for(var i = 0; i < nice.length; i++){ if(nice[i] * s <= 160) pick = nice[i]; }
    scaleBar.style.width = Math.round(pick * s) + "px";
    scaleTxt.textContent = pick + " cm";
    scaleBox.setAttribute("aria-label", "比例尺：這條線代表 " + pick + " 公分");
    scaleBox.hidden = false;
  }

  /* ---------- 展覽牆排版 ----------
     固定順序下，用「逐列排滿」的方式擺放；以二分搜尋找出放得下的最大比例尺。
     試多種隨機順序，選比例尺最大（畫最大）的那一種；同列的畫以中線對齊，最大的放中間 */
  function packRows(list, s, W, gap){
    var rows = [], row = [], rowW = 0, rowH = 0, totalH = 0;
    for(var i = 0; i < list.length; i++){
      var sz = sizeAt(list[i], s, MIN_SHORT_DESKTOP);
      if(sz.w > W) return null;
      if(row.length && rowW + gap + sz.w > W){
        rows.push({ items:row, w:rowW, h:rowH }); totalH += rowH;
        row = []; rowW = 0; rowH = 0;
      }
      rowW += (row.length ? gap : 0) + sz.w;
      rowH = Math.max(rowH, sz.h);
      row.push({ work:list[i], w:sz.w, h:sz.h });
    }
    if(row.length){ rows.push({ items:row, w:rowW, h:rowH }); totalH += rowH; }
    totalH += gap * (rows.length - 1);
    return { rows:rows, h:totalH };
  }
  function bestScale(list, W, H, gap){
    var hi = Infinity;
    list.forEach(function(w){ hi = Math.min(hi, W / w.width_cm, H / w.height_cm); });
    var lo = 0, best = null;
    for(var k = 0; k < 24; k++){
      var mid = (lo + hi) / 2, p = packRows(list, mid, W, gap);
      if(p && p.h <= H){ lo = mid; best = p; } else { hi = mid; }
    }
    return best ? { s:lo, pack:best } : null;
  }
  function centerTallest(items){
    var sorted = items.slice().sort(function(a, b){ return b.h - a.h; }), out = [];
    sorted.forEach(function(it, i){ if(i % 2) out.unshift(it); else out.push(it); });
    return out;
  }
  function layoutWall(list, W, H){
    var gap = Math.round(Math.max(16, Math.min(36, W * 0.025)));
    var best = null, tries = [list.slice().sort(function(a, b){ return b.height_cm - a.height_cm; })];
    var rand = seeded(list.map(function(w){ return w.id; }).join(","));
    for(var t = 0; t < 60; t++) tries.push(shuffle(list, rand));
    tries.forEach(function(order){
      var r = bestScale(order, W, H, gap);
      if(!r) return;
      if(!best || r.s > best.s * 1.01) best = r;
      else if(r.s > best.s * 0.99 && balance(r.pack) < balance(best.pack)) best = r;
    });
    if(!best) return null;
    var rows = best.pack.rows, n = rows.length;
    var extra = H - best.pack.h, rowGap = gap + Math.min(extra / (n + 1), gap);
    var totalH = rows.reduce(function(a, r){ return a + r.h; }, 0) + rowGap * (n - 1);
    var y = (H - totalH) / 2, placed = [];
    rows.forEach(function(r){
      var x = (W - r.w) / 2;
      centerTallest(r.items).forEach(function(it){
        placed.push({ work:it.work, x:x, y:y + (r.h - it.h) / 2, w:it.w, h:it.h });
        x += it.w + gap;
      });
      y += r.h + rowGap;
    });
    return { s:best.s, placed:placed };
  }
  function balance(pack){   // 各列寬度差異越小越平衡
    var ws = pack.rows.map(function(r){ return r.w; });
    var avg = ws.reduce(function(a, b){ return a + b; }, 0) / ws.length;
    return ws.reduce(function(a, b){ return a + (b - avg) * (b - avg); }, 0) / ws.length;
  }

  function pickWallSet(){
    var prev = {}; wallSet.forEach(function(w){ prev[w.id] = true; });
    var fresh = shuffle(works.filter(function(w){ return !prev[w.id]; }));
    var again = shuffle(works.filter(function(w){ return prev[w.id]; }));
    return fresh.concat(again).slice(0, Math.min(WALL_COUNT, works.length));
  }
  function renderWall(){
    if(!wallEl) return;
    var W = wallEl.clientWidth, H = wallEl.clientHeight;
    if(W < 50 || H < 50) return;
    var key = W + "x" + H + ":" + wallSet.map(function(w){ return w.id; }).join(",");
    if(key === wallEl.getAttribute("data-key")) return;      // 大小和作品都沒變就不重排
    wallEl.setAttribute("data-key", key);
    var L = layoutWall(wallSet, W, H);
    if(!L) return;
    wallEl.innerHTML = L.placed.map(function(p){
      var cls = "piece";
      if(p.y + p.h / 2 > H * 0.55) cls += " cap-up";
      if(p.x + p.w / 2 < 130) cls += " cap-l";
      else if(p.x + p.w / 2 > W - 130) cls += " cap-r";
      return '<a class="' + cls + '" href="work.html?id=' + encodeURIComponent(p.work.id) + '" aria-label="' + esc(label(p.work)) + '"' +
        ' style="left:' + p.x.toFixed(1) + "px;top:" + p.y.toFixed(1) + "px;width:" + p.w.toFixed(1) + "px;height:" + p.h.toFixed(1) + 'px">' +
        artHTML(p.work) +
        '<span class="ex-cap" aria-hidden="true"><strong>〈' + esc(p.work.title) + "〉</strong>" + esc(p.work.artist.name) + " · " + esc(sizeText(p.work)) + "</span></a>";
    }).join("");
    showScale(L.s);
  }
  function refreshWall(){
    var next = pickWallSet();
    var swap = function(){ wallSet = next; renderWall(); wallEl.classList.remove("is-fading"); live.textContent = "已換一批作品。"; };
    if(mqReduce.matches){ swap(); return; }
    wallEl.classList.add("is-fading");
    setTimeout(swap, 250);
  }

  /* ---------- 手機：一次一幅 ---------- */
  var hist = [], pos = -1, deck = [], card = null, singleS = 0, busy = false;
  var drag = null, suppressClick = false;

  function draw(){
    var cur = hist[pos];
    if(!deck.length){
      deck = shuffle(works.map(function(w){ return w.id; }).filter(function(id){ return id !== cur; }));
      if(!deck.length) deck = [cur];
    }
    return deck.pop();
  }
  function computeSingleScale(){
    var W = body.clientWidth, H = body.clientHeight - 84;   // 留給畫下方的說明
    var s = Infinity;
    works.forEach(function(w){ s = Math.min(s, W / w.width_cm, H / w.height_cm); });
    singleS = Math.max(0.1, s * 0.94);
  }
  function cardHTML(w){
    var sz = sizeAt(w, singleS, MIN_SHORT_MOBILE);
    var tag = STATUS_LABEL[w.status] ? '<span class="status">' + STATUS_LABEL[w.status] + "</span>" : "";
    var inner = w.image_url
      ? '<img src="' + esc(w.image_url) + '" alt="" draggable="false">'
      : '<span class="ph ' + esc(w.ph || "") + '"></span>';
    return '<a class="m-art" href="work.html?id=' + encodeURIComponent(w.id) + '" aria-label="' + esc(label(w)) + '" draggable="false"' +
      ' style="width:' + sz.w.toFixed(1) + "px;height:" + sz.h.toFixed(1) + 'px"><span class="ex-art">' + inner + "</span></a>" +
      '<div class="m-cap"><p class="m-title">〈' + esc(w.title) + '〉</p><p class="m-meta">' + esc(w.artist.name) + " · " + esc(sizeText(w)) + "</p>" + tag + "</div>";
  }
  function paintSingle(){
    var w = byId[hist[pos]];
    if(!card || !w) return;
    card.innerHTML = cardHTML(w);
    prevBtn.disabled = pos <= 0;
    showScale(singleS);
  }
  function go(dir){   // dir 1 = 下一幅（往左滑）、-1 = 上一幅（往右滑）
    if(busy) return;
    if(dir < 0 && pos <= 0){ snapBack(); return; }
    if(dir > 0){ if(pos >= hist.length - 1) hist.push(draw()); pos++; }
    else pos--;
    var w = byId[hist[pos]];
    live.textContent = "〈" + w.title + "〉" + w.artist.name;
    try{ sessionStorage.setItem("ex-swiped", "1"); }catch(e){}
    hint.hidden = true;
    if(mqReduce.matches){ card.style.transform = ""; card.style.opacity = ""; paintSingle(); return; }
    busy = true;
    var out = (dir > 0 ? -1 : 1) * body.clientWidth;
    card.classList.remove("is-dragging");
    card.style.transform = "translateX(" + out + "px)";
    card.style.opacity = "0";
    setTimeout(function(){
      paintSingle();
      card.classList.add("is-dragging");               // 先瞬間移到另一側
      card.style.transform = "translateX(" + (-out * 0.6) + "px)";
      void card.offsetWidth;
      card.classList.remove("is-dragging");
      card.style.transform = "";
      card.style.opacity = "";
      setTimeout(function(){ busy = false; }, 260);
    }, 220);
  }
  function snapBack(){
    card.classList.remove("is-dragging");
    card.style.transform = "";
  }
  function onDown(e){
    if(mode !== "single" || busy || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag = { x:e.clientX, y:e.clientY, dx:0, active:false, id:e.pointerId };
  }
  function onMove(e){
    if(!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if(!drag.active){
      if(Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)){
        drag.active = true;
        card.classList.add("is-dragging");
        try{ body.setPointerCapture(e.pointerId); }catch(err){}
      }else if(Math.abs(dy) > 10){ drag = null; return; }
      else return;
    }
    drag.dx = dx;
    var shown = (dx > 0 && pos <= 0) ? dx * 0.3 : dx;   // 沒有上一幅時拉不太動
    card.style.transform = "translateX(" + shown + "px) rotate(" + (shown / 40).toFixed(2) + "deg)";
  }
  function onUp(e){
    if(!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if(!d.active) return;
    suppressClick = true;
    setTimeout(function(){ suppressClick = false; }, 350);
    if(d.dx < -60) go(1);
    else if(d.dx > 60 && pos > 0) go(-1);
    else snapBack();
  }

  /* ---------- 切換模式 ---------- */
  function setMode(){
    var m = mqMobile.matches ? "single" : "wall";
    if(m === mode){ m === "wall" ? renderWall() : (computeSingleScale(), paintSingle()); return; }
    mode = m;
    body.innerHTML = "";
    nextBtn.hidden = false;          // 先讓底部列（按鈕、比例尺）佔好位置，量到的展覽牆高度才正確
    scaleBox.hidden = false;
    if(m === "wall"){
      wallEl = document.createElement("div");
      wallEl.className = "ex-wall";
      body.appendChild(wallEl);
      card = null;
      prevBtn.hidden = true; hint.hidden = true;
      nextTxt.textContent = "重新推薦";
      nextBtn.setAttribute("aria-label", "重新推薦：隨機換 10 幅作品");
      if(!wallSet.length) wallSet = pickWallSet();
      renderWall();
    }else{
      var stage = document.createElement("div");
      stage.className = "ex-single";
      card = document.createElement("div");
      card.className = "m-card";
      stage.appendChild(card);
      body.appendChild(stage);
      wallEl = null;
      prevBtn.hidden = false;
      nextTxt.textContent = "隨機下一幅";
      nextBtn.removeAttribute("aria-label");
      var seen = false; try{ seen = sessionStorage.getItem("ex-swiped") === "1"; }catch(e){}
      hint.hidden = seen;
      if(pos < 0){ hist = [draw()]; pos = 0; }
      computeSingleScale();
      paintSingle();
    }
  }

  var resizeTimer = 0;
  function onResize(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(setMode, 150);
  }

  /* 沒有作品或讀取失敗時，在展覽牆位置顯示說明（文字是固定的，不含使用者內容） */
  function showMessage(html){
    body.innerHTML = '<div class="ex-msg">' + html + "</div>";
  }

  getWorks().then(function(list){
    works = list || [];
    works.forEach(function(w){ byId[w.id] = w; });
    if(!works.length){
      showMessage('<p>目前還沒有可以展示的作品，過幾天再來看看。</p><a class="btn btn--ghost btn--sm" href="artists.html">去找畫家</a>');
      return;
    }
    setMode();
    nextBtn.addEventListener("click", function(){ mode === "wall" ? refreshWall() : go(1); });
    prevBtn.addEventListener("click", function(){ go(-1); });
    body.addEventListener("pointerdown", onDown);
    body.addEventListener("pointermove", onMove);
    body.addEventListener("pointerup", onUp);
    body.addEventListener("pointercancel", function(e){ if(drag && e.pointerId === drag.id){ drag = null; snapBack(); } });
    body.addEventListener("click", function(e){ if(suppressClick){ e.preventDefault(); e.stopPropagation(); } }, true);
    body.addEventListener("dragstart", function(e){ e.preventDefault(); });
    document.addEventListener("keydown", function(e){
      if(mode !== "single" || e.altKey || e.ctrlKey || e.metaKey) return;
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
      if(e.key === "ArrowLeft"){ e.preventDefault(); go(-1); }
      else if(e.key === "ArrowRight"){ e.preventDefault(); go(1); }
    });
    window.addEventListener("resize", onResize, { passive:true });
    /* 字型載入後標題高度會變，展覽牆可用的高度也跟著變：監看區塊大小再重排 */
    if(window.ResizeObserver){
      var lastW = body.clientWidth, lastH = body.clientHeight;
      new ResizeObserver(function(){
        if(body.clientWidth === lastW && body.clientHeight === lastH) return;
        lastW = body.clientWidth; lastH = body.clientHeight;
        onResize();
      }).observe(body);
    }
  }).catch(function(err){
    showMessage('<p>作品沒有順利載入：' + esc((err && err.message) || "請稍後再試一次。") + '</p><button class="btn btn--ghost btn--sm" type="button" onclick="location.reload()">重新整理</button>');
  });
})();
