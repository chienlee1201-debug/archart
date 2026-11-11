/* ============================================================
   account.js — 我的帳號（account.html）
   · 需要登入：訪客會被送到登入頁，登入完回來
   · 顯示自己的名字、大頭貼、Email（頁首的 data-slot="me-*" 由 site-chrome.js 填）
   · 修改顯示名稱
   · 我的許願：ArchDB.myWishes（sql/06_wishes.sql 的 arch_my_wishes），列出狀態、提案數、未通過的審核備註，連到願望頁
   · 收藏、詢問：階段 3 才接上，目前顯示「準備中」
   ============================================================ */
(function(){
  "use strict";

  var STATUS_TEXT = {
    draft: "你的畫家頁還是草稿，填完資料與作品就可以送出審核。",
    pending: "你的畫家頁正在審核中，通過後就會上架。",
    approved: "你的畫家頁已經上架。",
    needs_changes: "審核後需要修改，請到畫家後台看審核備註。"
  };

  /* 已上架畫家有還沒結案的修改時（arch_me 的 artist.revision） */
  var REVISION_TEXT = {
    draft: "你的畫家頁已經上架，另外有一份還沒送出審核的修改。",
    pending: "你的畫家頁已經上架，修改正在審核中，通過前網站上維持目前的版本。",
    rejected: "你的修改沒有通過審核，請到畫家後台看審核備註。"
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
    if(a && st){
      var t = STATUS_TEXT[a.status] || st.textContent;
      if(a.status === "approved" && a.revision) t = REVISION_TEXT[a.revision] || t;
      st.textContent = t;
    }

    if(loading) loading.hidden = true;
    if(body) body.hidden = false;
    if(location.hash){                         // 從別頁連到 #profile 等位置時，資料出現後再捲過去
      var target = document.getElementById(location.hash.slice(1));
      if(target) target.scrollIntoView();
    }
  }

  /* ---------- 我的許願 ---------- */
  function showWishes(){
    var box = document.querySelector('[data-slot="my-wishes"]');
    var C = window.ArchCards, W = window.ArchWish;
    if(!box || !C || !W) return;
    var el = C.el;
    ArchDB.myWishes().then(function(list){
      list = list || [];
      if(!list.length){
        C.fill(box, C.emptyBox("你還沒有許願。許願後，願望的審核狀態和畫家的提案會列在這裡。"));
        return;
      }
      C.fill(box, el("ul", { class: "rows my-wishes" }, list.map(function(w){
        var meta = [W.occasionText(w), W.budgetText(w.budget_range), "許願日期 " + W.dateText(w.created_at)].filter(Boolean).join("・");
        var side = [W.statusBadge(w.status)];
        if(w.status === "open" || w.status === "closed"){
          side.push(el("span", { text: w.proposal_count ? w.proposal_count + " 則提案" : "還沒有提案" }));
        }
        return el("li", { class: "row" }, [
          el("div", { class: "row-main" }, [
            el("h3", {}, [el("a", { href: W.wishHref(w), text: W.wishTitle(w) })]),
            el("p", { text: meta }),
            w.status === "pending" ? el("p", { class: "small", text: "審核通過後會出現在許願牆，畫家就能開始提案。" }) : null,
            w.status === "rejected" && w.review_note ? el("p", { class: "my-wish-note", text: "審核備註：" + w.review_note }) : null
          ]),
          el("div", { class: "row-side" }, side)
        ]);
      })));
    }).catch(function(err){
      C.fill(box, C.errorBox(err));
    });
  }

  ArchAuth.requirePage().then(function(me){
    if(!me) return;                            // 已經被送去登入頁
    show(me);
    showWishes();
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
