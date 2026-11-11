/* ============================================================
   wish.js — 單一願望（wish.html?id=…）
   需要先載入：config.js、images.js、supabase-js、db.js、auth.js、ui.js、cards.js

   · 公開資料：ArchDB.getWish（public_wishes＋public_proposals）
   · 登入的人另外讀 ArchDB.wishMe（sql/06_wishes.sql 的 arch_wish_me）
       許願者本人：看得到自己的聯絡方式、選了哪幾則提案；待審核／未通過的願望也看得到（附說明）
       畫家：自己對這個願望的提案（含是否被選中、是否被隱藏）
   · 右側欄依身分顯示其中一種：
       許願者本人   → 聯絡方式（只有自己看得到）、結束徵求；每則提案下面有「選擇這個提案」
       已上架畫家   → 提案表單；已經提過 → 自己的提案＋修改／刪除（願望徵求中、還沒被選中才可以）
       已登入但不是已上架畫家 → 「通過畫家審核後就能提案」＋成為畫家（已有畫家頁 → 前往畫家後台）
       訪客         → 「我要提案」：按下先登入，登入回來自動捲到提案表單（ArchAuth.requireLogin 的 data）
   · 公開頁不顯示誰被選中；只有許願者本人在自己的畫面上看到「✓ 已選擇」
   · 提案的畫家頭像用縮圖（cards.js 的 ArchWish.proposalItem → avatar，loading="lazy"）
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards, W = window.ArchWish;
  if(!C || !W || !window.ArchDB || !window.ArchAuth) return;
  var el = C.el;

  var MSG_MAX = 1000;
  var id = new URLSearchParams(location.search).get("id");
  function slot(n){ return document.querySelector('[data-slot="' + n + '"]'); }
  var aside = slot("aside");

  var state = { wish: null, proposals: [], mine: null, me: null, editing: false, flash: "" };

  /* ---------- 確認對話框 ---------- */
  var confirmDlg = document.getElementById("confirm-dialog");
  function ask(title, lines, okText, danger){
    return new Promise(function(resolve){
      if(!confirmDlg || !confirmDlg.showModal){ resolve(confirm(title + "\n" + lines.join("\n"))); return; }
      confirmDlg.querySelector('[data-slot="confirm-title"]').textContent = title;
      C.fill(confirmDlg.querySelector('[data-slot="confirm-text"]'), lines.map(function(t){ return el("p", { text: t }); }));
      var ok = confirmDlg.querySelector('[data-slot="confirm-ok"]');
      ok.textContent = okText;
      ok.className = "btn" + (danger ? " btn--danger" : "");
      var answered = false;
      function onOk(){ answered = true; confirmDlg.close(); }
      function onClose(){
        ok.removeEventListener("click", onOk);
        confirmDlg.removeEventListener("close", onClose);
        resolve(answered);
      }
      ok.addEventListener("click", onOk);
      confirmDlg.addEventListener("close", onClose);
      confirmDlg.showModal();
      ok.focus();
    });
  }

  function msgLine(){ return el("p", { class: "admin-msg", attrs: { role: "status", "aria-live": "polite" } }); }
  function say(n, text, bad){ n.textContent = text || ""; n.className = "admin-msg" + (bad ? " is-bad" : ""); }

  /* ============================================================
     左欄：願望內容＋提案
     ============================================================ */
  function isOwner(){ return !!(state.mine && state.mine.owner); }
  function selectedIds(){ return (state.mine && state.mine.selected) || []; }

  function renderWish(){
    var w = state.wish, t = W.wishTitle(w);
    document.title = t + "｜許願牆｜Arch";
    slot("crumb").textContent = t;

    /* 許願者本人看還沒公開的願望 */
    var notice = slot("owner-notice");
    notice.textContent = "";
    if(isOwner() && w.status === "pending"){
      notice.appendChild(el("p", { class: "notice notice--warn", text: "這個願望正在等待審核，通過後才會出現在許願牆，畫家也才能提案。目前只有你看得到這一頁。" }));
    }else if(isOwner() && w.status === "rejected"){
      notice.appendChild(el("div", { class: "notice notice--bad" }, [
        el("p", {}, [el("strong", { text: "這個願望沒有通過審核，不會公開。" }),
          w.review_note ? el("span", { class: "notice-quote", text: w.review_note }) : null,
          "有問題可以寫信到 archarttw@gmail.com。"])
      ]));
    }

    C.fill(slot("badges"), [W.statusBadge(w.status), isOwner() ? el("span", { class: "status", text: "你的願望" }) : null]);
    var tags = slot("tags");
    C.fill(tags, C.tagList(w.tags, 0, "題材"));
    tags.hidden = !tags.firstChild;
    slot("title").textContent = t;
    slot("title").classList.toggle("visually-hidden", !(w.title && String(w.title).trim()));   // 沒填標題：標題只給螢幕閱讀器（畫面上不重複內容開頭）
    slot("story").textContent = "「" + String(w.story || "").trim() + "」";
    C.fill(slot("facts"), W.wishFacts(w, true));
    slot("by").textContent = "— " + W.authorText(w);

    var intro = String(w.intro || "").trim();
    slot("intro").textContent = intro;
    slot("intro-box").hidden = !intro;

    renderProposals();
  }

  function renderProposals(){
    var list = state.proposals, w = state.wish;
    slot("prop-count").textContent = list.length ? "（" + list.length + "）" : "";
    var box = slot("proposals");
    if(!list.length){
      var text = w.status === "open" ? "還沒有畫家提案。" : (w.status === "closed" ? "這個願望沒有收到提案。" : "願望公開後，畫家的提案會出現在這裡。");
      C.fill(box, C.emptyBox(text));
      return;
    }
    var picked = selectedIds();
    C.fill(box, list.map(function(p){
      var item = W.proposalItem(p);
      if(isOwner()){
        var isPicked = picked.indexOf(p.id) > -1;
        if(isPicked){
          item.appendChild(el("p", { class: "proposal-picked", svg: "check" }, ["已選擇（只有你看得到）"]));
        }else if(w.status === "open"){
          var msg = msgLine();
          var b = el("button", { class: "btn btn--sm", text: "選擇這個提案", attrs: { type: "button" } });
          b.addEventListener("click", function(){ pick(p, b, msg); });
          item.appendChild(el("div", { class: "proposal-actions" }, [b, msg]));
        }
      }
      return item;
    }));
  }

  function pick(p, b, msg){
    var name = p.artist_name || "這位畫家";
    ask("選擇" + name + "的提案？", ["選了之後，" + name + "會看到你的聯絡方式。", "選了不能取消。你可以再選其他畫家，直到按「結束徵求」為止。"], "選擇這個提案")
      .then(function(yes){
        if(!yes) return;
        b.disabled = true;
        say(msg, "處理中…");
        return ArchDB.selectProposal(p.id).then(function(){
          state.flash = "已選擇" + name + "的提案。" + name + "會在畫家後台看到你的聯絡方式，再直接跟你聯絡。";
          return reload();
        }).catch(function(err){ b.disabled = false; say(msg, err.message, true); });
      });
  }

  /* ============================================================
     右側欄
     ============================================================ */
  function card(kids){ return el("div", { class: "aside-card" }, kids); }
  function flashBox(){
    if(!state.flash) return null;
    var n = el("p", { class: "notice notice--ok aside-flash", text: state.flash, attrs: { role: "status" } });
    state.flash = "";
    return n;
  }

  /* 許願者本人 */
  function ownerCard(){
    var w = state.wish, c = (state.mine && state.mine.contact) || {};
    var kids = [el("h2", { text: "這是你的願望" })];
    if(w.status === "open"){
      kids.push(el("p", { text: "看到喜歡的提案，按「選擇這個提案」，那位畫家就會看到你的聯絡方式，再直接跟你聯絡。可以選不只一位。" }));
    }else if(w.status === "closed"){
      kids.push(el("p", { text: "你已經結束徵求。提案會留在這裡，但不能再選擇提案，也不會收到新的提案。" }));
    }else if(w.status === "pending"){
      kids.push(el("p", { text: "審核通過後會出現在許願牆，畫家就能開始提案。" }));
    }else{
      kids.push(el("p", { text: "這個願望沒有通過審核，不會公開。" }));
    }

    var rows = [];
    if(c.email) rows.push(el("div", {}, [el("dt", { text: "Email" }), el("dd", { text: c.email })]));
    if(c.instagram) rows.push(el("div", {}, [el("dt", { text: "Instagram" }), el("dd", { text: "@" + c.instagram })]));
    kids.push(el("div", { class: "wish-private" }, [
      el("h3", { text: "你留的聯絡方式" }),
      rows.length ? el("dl", { class: "wish-private-list" }, rows) : el("p", { class: "small", text: "沒有留聯絡方式。" }),
      el("p", { class: "small", text: "只有你看得到，被你選中的畫家才看得到。" })
    ]));

    var n = selectedIds().length;
    if(n) kids.push(el("p", { class: "small wish-picked-count", text: "你已經選了 " + n + " 位畫家。" }));

    if(w.status === "open"){
      var msg = msgLine();
      var b = el("button", { class: "btn btn--ghost btn--block", text: "結束徵求", attrs: { type: "button" } });
      b.addEventListener("click", function(){
        ask("結束徵求？", ["結束之後，就不能再選擇提案，也不會再收到新的提案。", n ? "你已經選的 " + n + " 位畫家還是看得到你的聯絡方式。" : "你還沒有選任何提案。"], "結束徵求", true)
          .then(function(yes){
            if(!yes) return;
            b.disabled = true;
            say(msg, "處理中…");
            return ArchDB.closeWish(state.wish.id).then(function(){
              state.flash = "已結束徵求。";
              return reload();
            }).catch(function(err){ b.disabled = false; say(msg, err.message, true); });
          });
      });
      kids.push(b, msg);
    }
    kids.push(W.moreLink("account.html#wishes", "看我所有的許願"));
    return card(kids);
  }

  /* 提案表單（新增或修改） */
  function proposalForm(existing){
    var fid = "prop-msg";
    var ta = el("textarea", { class: "ctrl", attrs: { id: fid, name: "message", rows: "6", maxlength: String(MSG_MAX), "aria-describedby": fid + "-err" } });
    ta.value = existing ? existing.message : "";
    var counter = el("span", { class: "counter" });
    function count(){ counter.textContent = Array.from(ta.value).length + " / " + MSG_MAX; }
    count();
    var field = el("div", { class: "field" }, [
      el("label", { class: "q", attrs: { for: fid } }, ["你的提案", el("span", { class: "req", text: " *", attrs: { "aria-hidden": "true" } })]),
      el("span", { class: "hint", text: "只能寫文字，例如構圖、媒材、大約多久完成、大概的價格。" }),
      ta, counter,
      el("p", { class: "err", text: "請寫下你的提案。", attrs: { id: fid + "-err" } })
    ]);
    var msg = msgLine();
    var submit = el("button", { class: "btn btn--block", text: existing ? "儲存修改" : "送出提案（會直接公開）", attrs: { type: "submit" } });
    var kids = [field, submit];
    if(existing){
      var cancel = el("button", { class: "btn btn--ghost btn--block", text: "取消修改", attrs: { type: "button" } });
      cancel.addEventListener("click", function(){ state.editing = false; renderAside(); });
      kids.push(cancel);
    }
    kids.push(msg);
    var form = el("form", { class: "proposal-form", attrs: { novalidate: "" } }, kids);
    ta.addEventListener("input", function(){ count(); field.classList.remove("is-invalid"); say(msg, ""); });
    form.addEventListener("submit", function(e){
      e.preventDefault();
      var v = ta.value.trim();
      if(!v){ field.classList.add("is-invalid"); ta.focus(); return; }
      submit.disabled = true;
      say(msg, "送出中…");
      ArchDB.saveProposal(state.wish.id, v).then(function(){
        state.editing = false;
        state.flash = existing ? "已儲存修改。" : "提案送出了，已經公開在這個願望下面。";
        return reload();
      }).catch(function(err){ submit.disabled = false; say(msg, err.message, true); });
    });
    return form;
  }

  /* 已上架畫家 */
  function artistCard(){
    var mp = state.mine && state.mine.my_proposal;
    var open = state.wish.status === "open";
    if(!mp){
      if(!open) return closedCard();
      return card([
        el("h2", { text: "我想接這個願望" }),
        el("p", { text: "寫下你想怎麼畫。提案會公開在這裡，並附上你的畫家頁連結。" }),
        proposalForm(null)
      ]);
    }
    if(state.editing && open && !mp.selected && mp.status === "open"){
      return card([el("h2", { text: "修改你的提案" }), proposalForm(mp)]);
    }

    var kids = [
      el("h2", { text: "你的提案" }),
      W.timeEl(mp.created_at, "muted small"),
      el("p", { class: "my-proposal", text: mp.message })
    ];
    if(mp.selected){
      kids.push(el("div", { class: "notice notice--ok" }, [el("p", {}, [
        el("strong", { text: "許願者選了你的提案。" }), "到畫家後台的「許願提案」看對方的聯絡方式。"])]));
      kids.push(el("a", { class: "btn btn--block", href: "studio.html#proposals", text: "前往畫家後台" }));
    }else if(mp.status !== "open"){
      kids.push(el("p", { class: "notice notice--warn", text: "這則提案已被管理者隱藏，不會公開顯示。有問題可以寫信到 archarttw@gmail.com。" }));
    }
    if(!open){
      kids.push(el("p", { class: "small", text: "這個願望已經結束徵求，提案不能再修改。" }));
    }else if(!mp.selected){
      var msg = msgLine();
      var row = el("div", { class: "btn-row" });
      if(mp.status === "open"){
        var edit = el("button", { class: "btn btn--sm", text: "修改提案", attrs: { type: "button" } });
        edit.addEventListener("click", function(){
          state.editing = true;
          renderAside();
          var ta = document.getElementById("prop-msg");
          if(ta) ta.focus();
        });
        row.appendChild(edit);
      }
      var del = el("button", { class: "btn btn--danger btn--sm", text: "刪除提案", attrs: { type: "button" } });
      del.addEventListener("click", function(){
        ask("刪除你的提案？", ["刪除後，這則提案會從願望下面消失。願望還在徵求的話，你可以再重新提案。"], "刪除提案", true)
          .then(function(yes){
            if(!yes) return;
            del.disabled = true;
            say(msg, "處理中…");
            return ArchDB.deleteProposal(mp.id).then(function(){
              state.flash = "已刪除你的提案。";
              return reload();
            }).catch(function(err){ del.disabled = false; say(msg, err.message, true); });
          });
      });
      row.appendChild(del);
      kids.push(row, msg);
    }
    return card(kids);
  }

  /* 願望已結束（不是許願者、也沒有提過） */
  function closedCard(){
    return card([
      el("h2", { text: "這個願望已結束徵求" }),
      el("p", { text: "許願者已經不再收新的提案。到許願牆看看其他正在徵求的願望吧。" }),
      el("a", { class: "btn btn--ghost btn--block", href: "wishes.html", text: "看其他願望" })
    ]);
  }

  /* 已登入，但不是已上架畫家 */
  function notArtistCard(){
    var a = state.me && state.me.artist;
    return card([
      el("h2", { text: "想對這個願望提案嗎？" }),
      el("p", { text: a
        ? "你的畫家頁通過審核、上架之後，就能對願望提案。"
        : "通過畫家審核後就能提案。用同一個帳號申請，審核通過、畫家頁上架之後就可以。" }),
      a ? el("a", { class: "btn btn--block", href: "studio.html", text: "前往畫家後台" })
        : el("a", { class: "btn btn--block", href: "apply.html", text: "成為 Arch 畫家" })
    ]);
  }

  /* 訪客 */
  function guestCard(){
    var b = el("button", { class: "btn btn--block", text: "我要提案", attrs: { type: "button", id: "propose-login" } });
    b.addEventListener("click", function(){
      ArchAuth.requireLogin("對這個願望提案", null, { propose: id });
    });
    return card([
      el("h2", { text: "你是畫家嗎？" }),
      el("p", { text: "已上架的 Arch 畫家可以對這個願望提案，寫下你想怎麼畫。按下後先用 Google 登入。" }),
      b,
      el("p", { class: "small aside-more" }, ["還不是 Arch 畫家？", el("a", { href: "apply.html", text: "申請成為畫家" })])
    ]);
  }

  function renderAside(){
    var me = state.me, w = state.wish, node;
    if(isOwner()) node = ownerCard();
    else if(me && me.artist && me.artist.status === "approved") node = artistCard();
    else if(w.status !== "open") node = closedCard();
    else if(me) node = notArtistCard();
    else node = guestCard();
    C.fill(aside, [flashBox(), node]);
  }

  /* ============================================================
     讀取
     ============================================================ */
  function fetchAll(){
    return Promise.all([
      ArchDB.getWish(id),
      ArchAuth.ready.then(function(me){
        state.me = me;
        if(!me || !/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
        return ArchDB.wishMe(id).catch(function(err){
          console.warn("[Arch] 讀不到我在這個願望的資料：", err && err.cause || err);
          return null;
        });
      })
    ]).then(function(r){
      var pub = r[0], mine = r[1];
      state.mine = mine;
      if(mine && mine.owner && mine.wish){
        state.wish = mine.wish;                         // 本人：用完整資料（含待審核、未通過）
      }else{
        state.wish = pub.wish;
      }
      state.proposals = pub.wish ? pub.proposals : [];
      return !!state.wish;
    });
  }

  function reload(){
    return fetchAll().then(function(ok){
      if(!ok){ C.showState("missing"); return; }
      renderWish();
      renderAside();
    });
  }

  var reloadBtn = document.querySelector('[data-action="reload"]');
  if(reloadBtn) reloadBtn.addEventListener("click", function(){ location.reload(); });

  fetchAll().then(function(ok){
    if(!ok){
      document.title = "找不到這個願望｜Arch";
      C.showState("missing");
      return;
    }
    renderWish();
    renderAside();
    C.showState("ready");
    /* 訪客按「我要提案」登入回來：捲到提案表單 */
    var pend = ArchAuth.pendingData();
    if(pend && pend.propose === id){
      aside.scrollIntoView({ block: "start" });
      var ta = document.getElementById("prop-msg");
      if(ta) ta.focus();
    }
  }).catch(function(err){
    slot("error-msg").textContent = (err && err.message) || "請檢查網路後再試一次。";
    C.showState("error");
  });
})();
