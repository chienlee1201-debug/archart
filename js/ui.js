/* ============================================================
   ui.js — 純介面行為（不碰資料庫）
   · [data-open="對話框id"] 開啟對話框；[data-close] 或點背景關閉
   · 點選單外面時收起 <details class="pop">
   · 收藏按鈕切換外觀（預覽用；接上資料庫後改由 favorites 決定）
   · [data-tabs] 分頁切換（沒有 JS 時全部內容都看得到）
   ============================================================ */
(function(){
  "use strict";

  document.addEventListener("click", function(e){
    var t = e.target;

    var opener = t.closest("[data-open]");
    if(opener){
      var dlg = document.getElementById(opener.dataset.open);
      if(dlg && dlg.showModal){ e.preventDefault(); dlg.showModal(); }
      return;
    }

    var closer = t.closest("[data-close]");
    if(closer){
      var parent = closer.closest("dialog");
      if(parent) parent.close();
      return;
    }

    if(t.tagName === "DIALOG"){ t.close(); return; }   // 點到對話框外的背景

    var fav = t.closest(".fav-btn,[data-fav]");
    if(fav){
      fav.setAttribute("aria-pressed", fav.getAttribute("aria-pressed") === "true" ? "false" : "true");
    }

    Array.prototype.forEach.call(document.querySelectorAll("details.pop[open]"), function(p){
      if(!p.contains(t)) p.removeAttribute("open");
    });
  });

  // 網址帶 #new 時打開許願對話框（首頁「我要許願」連過來）。
  // 用「按一下我要許願按鈕」的方式打開，訪客才會先看到登入提示（auth.js 的 data-login-reason）
  if(location.hash === "#new"){
    var newBtn = document.getElementById("new");
    var wish = document.getElementById("wish-dialog");
    if(newBtn) newBtn.click();
    else if(wish && wish.showModal) wish.showModal();
  }

  // 分頁切換（例如「關於 Arch」的常見問題：給畫家／給收藏家）
  // 寫法：<div data-tabs> 裡放 <div role="tablist" hidden>＋<button role="tab" id aria-controls="面板id">，面板是一般區塊。
  // 沒有 JS 時分頁列藏著、所有面板都看得到；這裡才把分頁列打開、只留選中的面板。
  // 網址 #面板id 會直接打開那一個分頁；鍵盤可用左右鍵、Home、End 切換。
  Array.prototype.forEach.call(document.querySelectorAll("[data-tabs]"), function(box){
    var tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]'));
    if(!tabs.length) return;
    function panelOf(t){ return document.getElementById(t.getAttribute("aria-controls")); }
    function select(t, focus){
      tabs.forEach(function(x){
        var on = x === t;
        x.setAttribute("aria-selected", on ? "true" : "false");
        x.tabIndex = on ? 0 : -1;
        var p = panelOf(x);
        if(p) p.hidden = !on;
      });
      if(focus) t.focus();
    }
    function fromHash(){
      return tabs.filter(function(t){ return location.hash === "#" + t.getAttribute("aria-controls"); })[0];
    }
    tabs.forEach(function(t, i){
      var p = panelOf(t);
      if(p){ p.setAttribute("role", "tabpanel"); p.setAttribute("aria-labelledby", t.id); p.tabIndex = 0; }
      t.addEventListener("click", function(){ select(t); });
      t.addEventListener("keydown", function(e){
        var n = tabs.length, j = null;
        if(e.key === "ArrowRight") j = (i + 1) % n;
        else if(e.key === "ArrowLeft") j = (i - 1 + n) % n;
        else if(e.key === "Home") j = 0;
        else if(e.key === "End") j = n - 1;
        if(j !== null){ e.preventDefault(); select(tabs[j], true); }
      });
    });
    var list = box.querySelector('[role="tablist"]');
    if(list) list.hidden = false;
    box.classList.add("is-tabbed");
    select(fromHash() || tabs[0]);
    window.addEventListener("hashchange", function(){
      var t = fromHash();
      if(t){ select(t); box.scrollIntoView(); }
    });
  });
})();
