/* ============================================================
   home.js — 首頁（index.html）的資料區塊，資料來自 ArchDB.getCatalog()
   · 開頭作品列（data-slot="hero-works"）：每位已上架畫家的第一件作品（position 最前），
     每次進來順序隨機，讓每位畫家都有機會排在最前面；最多 12 件
   · 精選畫家（data-slot="featured"）：管理者在管理後台「首頁精選」選的畫家（最多 6 位，依設定順序；
     ArchDB.getFeatured()，sql/03_featured.sql）。一位都沒設定、或讀不到精選名單時，
     改顯示排序最前面的 6 位（sort_order → created_at）
   · 最新作品（data-slot="new-works"）：依作品建立時間由新到舊，每位畫家最多一件，共 4 件
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards;
  if(!C || !window.ArchDB) return;

  var STRIP_MAX = 12, FEATURED = 6, NEWEST = 4;

  var strip = document.querySelector('[data-slot="hero-works"]');
  var board = document.querySelector('[data-slot="featured"]');
  var newest = document.querySelector('[data-slot="new-works"]');

  /* 作品列的一格：〈作品名〉／畫家 · 媒材 · 尺寸 */
  function stripItem(w){
    var t = C.workTitle(w);
    var art = C.el("div", { class: "strip-art" }, [C.workArt(w, "作品〈" + t + "〉")]);
    return C.el("a", { class: "strip-item", href: C.workHref(w) }, [
      art,
      C.el("span", { class: "strip-title", text: "〈" + t + "〉" }),
      C.el("span", { class: "strip-meta", text: [w.artist.name, C.mediumText(w, false), C.sizeText(w)].filter(Boolean).join(" · ") })
    ]);
  }

  /* 精選畫家晾衣線名片（index.html 的 #featured：名片用小木夾掛在一條線上，一排左右滑） */
  function lineCard(a){
    return C.el("li", { class: "fitem" }, [
      C.el("a", { class: "fcard", href: C.artistHref(a) }, [
        C.avatar(a, "avatar fcard-avatar"),
        C.el("span", { class: "fcard-body" }, [
          C.el("h3", { class: "fcard-name", text: a.name }),
          C.tagList(a.tags, 3, "風格")
        ]),
        a.tagline ? C.el("p", { class: "fcard-sub", text: a.tagline }) : null
      ])
    ]);
  }

  /* 區塊沒有資料或讀取失敗時：換成一行說明，不留空白
     作品列、精選畫家的外層都是 .strip-wrap：連同左右箭頭（精選畫家還有那條線）一起換掉 */
  function replaceWith(container, box){
    var wrap = container.closest(".strip-wrap") || container;
    if(wrap !== container){
      // 作品列／精選畫家：連同左右箭頭一起換掉，說明放在內容欄裡
      var shell = C.el("div", { class: "shell" }, [box]);
      wrap.replaceWith(shell);
      return;
    }
    var holder = C.el("div", {}, [box]);
    container.replaceWith(holder);
  }

  /* 精選名單讀不到（例如還沒執行 sql/03_featured.sql）就當作沒有設定，不影響首頁其他區塊 */
  var featuredIds = window.ArchDB.getFeatured ? window.ArchDB.getFeatured().catch(function(){ return []; }) : Promise.resolve([]);

  Promise.all([window.ArchDB.getCatalog(), featuredIds]).then(function(r){
    var cat = r[0], ids = r[1] || [];
    /* 開頭作品列 */
    var reps = C.shuffle(cat.artists.map(function(a){ return a.works[0]; }).filter(Boolean)).slice(0, STRIP_MAX);
    if(reps.length){
      C.fill(strip, reps.map(stripItem));
      strip.scrollLeft = 0;
      strip.dispatchEvent(new Event("scroll"));     // 讓左右箭頭依新的內容重新判斷要不要顯示
    }else{
      replaceWith(strip, C.emptyBox("作品正在整理中，過幾天再來看看。"));
    }

    /* 精選畫家 */
    var byId = {};
    cat.artists.forEach(function(a){ byId[a.id] = a; });
    var featured = ids.map(function(id){ return byId[id]; }).filter(Boolean).slice(0, FEATURED);
    if(!featured.length) featured = cat.artists.slice(0, FEATURED);   // 還沒設定精選：照排序取前 6 位
    if(featured.length) C.fill(board, featured.map(lineCard));
    else replaceWith(board, C.emptyBox("畫家正在陸續加入中，過幾天再來看看。"));

    /* 最新作品 */
    var seen = {}, latest = cat.works.slice().sort(function(a, b){
      return String(b.created_at).localeCompare(String(a.created_at)) || (a.position - b.position);
    }).filter(function(w){
      if(seen[w.artist_id]) return false;
      seen[w.artist_id] = true;
      return true;
    }).slice(0, NEWEST);
    if(latest.length) C.fill(newest, latest.map(function(w){ return C.workCard(w, { showArtist: true }); }));
    else replaceWith(newest, C.emptyBox("目前還沒有上架的作品。"));
  }).catch(function(err){
    replaceWith(strip, C.errorBox(err));
    replaceWith(board, C.emptyBox("畫家資料暫時載入不了，請重新整理頁面。"));
    replaceWith(newest, C.emptyBox("作品暫時載入不了，請重新整理頁面。"));
  });
})();
