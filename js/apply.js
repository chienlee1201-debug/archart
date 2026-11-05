/* ============================================================
   apply.js — 申請成為畫家（apply.html）
   · 看這頁不用登入；按「下一步」時，訪客先跳出 Google 登入提示（auth.js 的 data-login-reason），
     登入回來後自動再按一次。勾選的內容先記在這個分頁（sessionStorage），登入回來不會不見
   · 勾了原創聲明 → 建立自己的草稿畫家頁（ArchDB.startArtist，來源 referral_source 一起存）→ 前往畫家後台
   · 已經有畫家頁的人：不顯示表單，改成「前往畫家後台」
   ============================================================ */
(function(){
  "use strict";
  var KEY = "arch.apply";
  var form = document.getElementById("apply-form");
  var box = document.getElementById("original");
  var field = document.getElementById("original-field");
  var btn = document.getElementById("apply-submit");
  var errEl = document.querySelector('[data-slot="apply-error"]');
  if(!form || !box || !field || !btn || !window.ArchAuth) return;

  function picked(){
    var r = form.querySelector('input[name="referral_source"]:checked');
    return r ? r.value : "";
  }
  function remember(){
    try{ sessionStorage.setItem(KEY, JSON.stringify({ ref: picked(), original: box.checked })); }catch(e){}
  }
  function restore(){
    try{
      var v = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if(!v) return;
      if(v.ref){
        var r = form.querySelector('input[name="referral_source"][value="' + v.ref + '"]');
        if(r) r.checked = true;
      }
      box.checked = !!v.original;
    }catch(e){}
  }
  function showError(msg){
    errEl.textContent = msg || "";
    errEl.style.display = msg ? "block" : "";
  }

  /* 沒勾原創聲明時，按鈕先不觸發登入提示，直接顯示「請先勾選」 */
  var REASON = btn.getAttribute("data-login-reason");
  function syncReason(){
    if(box.checked) btn.setAttribute("data-login-reason", REASON);
    else btn.removeAttribute("data-login-reason");
  }

  restore();
  syncReason();
  form.addEventListener("change", function(){
    remember();
    syncReason();
    if(box.checked) field.classList.remove("is-invalid");
  });

  ArchAuth.ready.then(function(me){
    if(me && me.artist){
      form.hidden = true;
      document.querySelector('[data-slot="apply-done"]').hidden = false;
    }
  });

  form.addEventListener("submit", function(e){
    e.preventDefault();
    showError("");
    if(!box.checked){
      field.classList.add("is-invalid");
      box.focus();
      return;
    }
    if(!ArchAuth.me()) return;          // 訪客：auth.js 已經跳出登入提示
    btn.disabled = true;
    ArchDB.startArtist(picked() || null).then(function(){
      try{ sessionStorage.removeItem(KEY); }catch(err){}
      var go = function(){ location.href = "studio.html"; };
      ArchAuth.refresh().then(go, go);
    }).catch(function(err){
      btn.disabled = false;
      showError(((err && err.message) || "沒有成功") + "，請再試一次。");
    });
  });
})();
