/* ============================================================
   ui.js — 純介面行為（不碰資料庫）
   · [data-open="對話框id"] 開啟對話框；[data-close] 或點背景關閉
   · 點選單外面時收起 <details class="pop">
   · 收藏按鈕切換外觀（預覽用；接上資料庫後改由 favorites 決定）
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

  // 網址帶 #new 時直接打開許願對話框（首頁「我要許願」連過來）
  if(location.hash === "#new"){
    var wish = document.getElementById("wish-dialog");
    if(wish && wish.showModal) wish.showModal();
  }
})();
