/* ============================================================
   account.js — 我的帳號（account.html）
   · 需要登入：訪客會被送到登入頁，登入完回來
   · 顯示自己的名字、大頭貼、Email（頁首的 data-slot="me-*" 由 site-chrome.js 填）
   · 修改顯示名稱
   · 收藏、詢問、許願：階段 3、4 才接上，目前顯示「準備中」
   ============================================================ */
(function(){
  "use strict";

  var STATUS_TEXT = {
    draft: "你的畫家頁還是草稿，填完資料與作品就可以送出審核。",
    pending: "你的畫家頁正在審核中，通過後就會上架。",
    approved: "你的畫家頁已經上架。",
    needs_changes: "審核後需要修改，請到畫家後台看審核備註。"
  };

  var loading = document.querySelector('[data-slot="account-loading"]');
  var body = document.querySelector('[data-slot="account-body"]');
  var form = document.getElementById("profile-form");
  var nameInput = document.getElementById("me-name");
  var nameField = document.getElementById("me-name-field");
  var emailInput = document.getElementById("me-email");
  var statusEl = document.querySelector('[data-slot="profile-status"]');

  function show(me){
    nameInput.value = me.display_name || "";
    emailInput.value = me.email || "";

    var a = me.artist;
    var applyCard = document.querySelector('#artist [data-view="apply"]');
    var studioCard = document.querySelector('#artist [data-view="studio"]');
    var nav = document.querySelector('[data-slot="artist-nav"]');
    if(applyCard) applyCard.hidden = !!a;
    if(studioCard) studioCard.hidden = !a;
    if(nav) nav.textContent = a ? "我的畫家頁" : "成為畫家";
    var st = document.querySelector('[data-slot="artist-status"]');
    if(a && st) st.textContent = STATUS_TEXT[a.status] || st.textContent;

    if(loading) loading.hidden = true;
    if(body) body.hidden = false;
    if(location.hash){                         // 從別頁連到 #profile 等位置時，資料出現後再捲過去
      var target = document.getElementById(location.hash.slice(1));
      if(target) target.scrollIntoView();
    }
  }

  ArchAuth.requirePage().then(function(me){
    if(!me) return;                            // 已經被送去登入頁
    show(me);
  });

  form.addEventListener("submit", function(e){
    e.preventDefault();
    var name = nameInput.value.trim();
    if(!name || Array.from(name).length > 40){
      nameField.classList.add("is-invalid");
      nameInput.focus();
      return;
    }
    nameField.classList.remove("is-invalid");

    var me = ArchAuth.me();
    if(!me) return;
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    statusEl.textContent = "儲存中…";
    ArchDB.updateProfile(me.id, { display_name: name })
      .then(function(){ return ArchAuth.refresh(); })
      .then(function(){ statusEl.textContent = "已儲存。"; })
      .catch(function(err){ statusEl.textContent = err.message || "儲存失敗，請再試一次。"; })
      .then(function(){ btn.disabled = false; });
  });

  nameInput.addEventListener("input", function(){
    nameField.classList.remove("is-invalid");
    statusEl.textContent = "";
  });
})();
