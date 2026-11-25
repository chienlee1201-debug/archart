/* ============================================================
   favorites.js — 收藏（愛心）
   需要先載入：db.js、auth.js（cards.js 的卡片會用到這裡的 ArchFav.mark）

   · 愛心按鈕：<button class="fav-btn" data-fav-work="作品 id"> 或 data-fav-artist="畫家 id"
     （cards.js 的作品卡、畫家卡會自動加上；作品頁、畫家頁由各自的程式加）
   · 登入的人：按一下收藏、再按一下取消；同一頁上同一件作品／畫家的愛心一起變
   · 訪客：跳出「先登入再繼續」（2026-11-25 決定，不做瀏覽器暫存），登入回來後自動幫他收藏剛剛那一個
   · 收藏清單登入後讀一次；之後才畫出來的愛心用 ArchFav.mark(btn) 決定一開始是不是紅心
   · ArchFav.ready：讀完收藏清單（訪客＝空清單）；ArchFav.list()：[{ kind, id, created_at }]，新的在前（我的帳號用）
   ============================================================ */
(function(){
  "use strict";

  var saved = {};      // "work:id"／"artist:id" → 收藏時間
  var busy = {};       // 正在存的，避免連點

  function key(kind, id){ return kind + ":" + id; }

  function has(kind, id){ return Object.prototype.hasOwnProperty.call(saved, key(kind, id)); }

  function targetOf(btn){
    var w = btn.getAttribute("data-fav-work");
    if(w) return { kind: "work", id: w };
    var a = btn.getAttribute("data-fav-artist");
    if(a) return { kind: "artist", id: a };
    return null;
  }

  /* 依收藏清單設定一個愛心的紅心／空心 */
  function mark(btn){
    var t = targetOf(btn);
    if(t) btn.setAttribute("aria-pressed", has(t.kind, t.id) ? "true" : "false");
  }

  function markAll(){
    Array.prototype.forEach.call(document.querySelectorAll(".fav-btn[data-fav-work],.fav-btn[data-fav-artist]"), mark);
  }

  function set(kind, id, on){
    if(on) saved[key(kind, id)] = saved[key(kind, id)] || new Date().toISOString();
    else delete saved[key(kind, id)];
    markAll();
  }

  /* 收藏／取消：先改畫面，存失敗再改回來 */
  function save(kind, id, on){
    var k = key(kind, id);
    if(busy[k]) return Promise.resolve();
    var me = ArchAuth.me();
    if(!me) return Promise.resolve();
    busy[k] = true;
    set(kind, id, on);
    var job = on ? ArchDB.addFavorite(kind, id) : ArchDB.removeFavorite(me.id, kind, id);
    return job.catch(function(err){
      set(kind, id, !on);
      alert((on ? "收藏" : "取消收藏") + "沒有成功：" + ((err && err.message) || "請再試一次。"));
    }).then(function(){ delete busy[k]; });
  }

  var ready = ArchAuth.ready.then(function(me){
    if(!me) return;
    return ArchDB.myFavorites(me.id).then(function(rows){
      (rows || []).forEach(function(r){
        if(r.work_id) saved[key("work", r.work_id)] = r.created_at;
        else if(r.artist_id) saved[key("artist", r.artist_id)] = r.created_at;
      });
      markAll();
      // 訪客按愛心 → 登入回來：幫他收藏剛剛那一個（auth.js 存的 pendingData）
      var p = ArchAuth.pendingData();
      if(p && p.fav && !has(p.fav.kind, p.fav.id)) return save(p.fav.kind, p.fav.id, true);
    });
  }).catch(function(err){
    if(window.console) console.warn("[Arch] 讀取收藏失敗：", err && err.cause || err);
  });

  document.addEventListener("click", function(e){
    var btn = e.target.closest && e.target.closest(".fav-btn");
    if(!btn) return;
    var t = targetOf(btn);
    if(!t) return;
    e.preventDefault();
    ArchAuth.requireLogin("收藏喜歡的作品和畫家", null, { fav: t }).then(function(ok){
      if(!ok) return;
      ready.then(function(){ save(t.kind, t.id, !has(t.kind, t.id)); });
    });
  });

  window.ArchFav = {
    ready: ready,
    has: has,
    mark: mark,
    list: function(){
      return Object.keys(saved).map(function(k){
        var i = k.indexOf(":");
        return { kind: k.slice(0, i), id: k.slice(i + 1), created_at: saved[k] };
      }).sort(function(a, b){ return String(b.created_at).localeCompare(String(a.created_at)); });
    }
  };
})();
