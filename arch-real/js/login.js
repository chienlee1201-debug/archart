/* ============================================================
   login.js — 登入頁（login.html）
   · 已經登入的人直接送回 ?next= 指定的頁面（沒指定就回首頁）
   · 「先不登入，繼續逛」也回到原本那一頁
   · Google 按鈕的動作在 auth.js（data-action="login-google"）
   ============================================================ */
(function(){
  "use strict";
  var next = ArchAuth.nextFromQuery() || "index.html";

  var guest = document.querySelector("[data-slot='login-back']");
  if(guest) guest.setAttribute("href", next);

  ArchAuth.ready.then(function(me){
    if(me) location.replace(next);
  });
})();
