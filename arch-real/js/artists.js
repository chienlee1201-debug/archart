/* ============================================================
   artists.js — 找畫家（artists.html）
   · 看畫家／看作品（?view=works）兩種檢視，資料來自 ArchDB.getCatalog()
   · 排序：畫家依 sort_order → created_at；作品依畫家順序 → position
   · 搜尋、篩選、排序選單在階段 3 才實作，目前停用（畫面上有說明）
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards;
  if(!C || !window.ArchDB) return;

  var view = new URLSearchParams(location.search).get("view") === "works" ? "works" : "artists";
  var grids = {
    artists: document.querySelector('[data-view="artists"]'),
    works: document.querySelector('[data-view="works"]')
  };
  var count = document.querySelector('[data-slot="count"]');
  var unit = document.querySelector('[data-slot="unit"]');
  var live = document.querySelector('[data-slot="live"]');
  if(!grids.artists || !grids.works) return;

  /* 切換檢視：分段按鈕、顯示哪一個格線、標題 */
  grids.artists.hidden = view !== "artists";
  grids.works.hidden = view !== "works";
  Array.prototype.forEach.call(document.querySelectorAll("[data-seg]"), function(a){
    if(a.getAttribute("data-seg") === view) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
  unit.textContent = view === "works" ? "件作品" : "位畫家";
  if(view === "works") document.title = "看作品・找畫家｜Arch";

  var grid = grids[view];

  window.ArchDB.getCatalog().then(function(cat){
    var list = view === "works" ? cat.works : cat.artists;
    count.textContent = String(list.length);
    if(!list.length){
      grid.classList.remove("grid", "grid--works");
      C.fill(grid, C.emptyBox(view === "works" ? "目前還沒有上架的作品，過幾天再來看看。" : "目前還沒有上架的畫家，過幾天再來看看。"));
      live.textContent = "目前沒有資料。";
      return;
    }
    C.fill(grid, list.map(function(x){
      return view === "works" ? C.workCard(x, { showArtist: true }) : C.artistCard(x);
    }));
    live.textContent = "已載入 " + list.length + (view === "works" ? " 件作品。" : " 位畫家。");
  }).catch(function(err){
    count.textContent = "0";
    grid.classList.remove("grid", "grid--works");
    C.fill(grid, C.errorBox(err));
    live.textContent = "";
  });
})();
