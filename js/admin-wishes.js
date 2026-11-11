/* ============================================================
   admin-wishes.js — 管理後台「願望審核」「提案」分頁（admin.html#wishes、#proposals）
   需要先載入：db.js、auth.js、cards.js（admin.js 之後載入；是不是管理者由 admin.js 檢查、非管理者導回首頁）
   寫法照 admin.js 的畫家分頁：狀態篩選＋每筆一個可展開的 <details class="review">

   · 願望（sql/06_wishes.sql 的 arch_admin_wishes／arch_admin_review_wish）
       依狀態篩選：待審核／徵求提案中／已結束／未通過／全部
       每筆：許願者帳號、公開顯示、聯絡方式（不公開，只有管理者與被選中的畫家看得到）、場合、預算、尺寸、題材、提案數
       待審核：公開／不通過（備註必填，許願者看得到）；徵求提案中：撤下（改成未通過，備註必填）
   · 提案（arch_admin_proposals／arch_admin_hide_proposal）
       依狀態篩選：公開中／已隱藏／全部；每筆可以隱藏或取消隱藏
       管理者看得到「許願者有沒有選這則提案」（公開頁不顯示）
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards, W = window.ArchWish;
  if(!C || !W || !window.ArchDB || !window.ArchAuth) return;
  var el = C.el;

  var wishList = document.querySelector('[data-slot="wish-list"]');
  var wishFilters = document.querySelector('[data-slot="wish-filters"]');
  var propList = document.querySelector('[data-slot="prop-list"]');
  var propFilters = document.querySelector('[data-slot="prop-filters"]');
  if(!wishList || !wishFilters || !propList || !propFilters) return;

  var WISH_EMPTY = { pending: "沒有待審核的願望。", open: "沒有徵求中的願望。", closed: "沒有已結束的願望。", rejected: "沒有未通過的願望。", all: "還沒有任何願望。" };
  var PROP_EMPTY = { open: "沒有公開中的提案。", hidden: "沒有隱藏的提案。", all: "還沒有任何提案。" };

  var wishes = [], proposals = [];
  var wishFilter = "pending", propFilter = "open";
  var openIds = {};                    // 重新整理清單時，保持原本展開的那幾筆
  var wishFlash = "", propFlash = "";

  function btn(text, cls, onClick){
    var b = el("button", { class: "btn btn--sm " + (cls || ""), text: text, attrs: { type: "button" } });
    if(onClick) b.addEventListener("click", function(){ onClick(b); });
    return b;
  }
  function msgLine(){ return el("p", { class: "admin-msg", attrs: { role: "status", "aria-live": "polite" } }); }
  function say(n, text, bad){ n.textContent = text || ""; n.className = "admin-msg" + (bad ? " is-bad" : ""); }
  function facts(rows){
    return el("dl", { class: "admin-facts" }, rows.filter(function(r){ return r && r[1] !== ""; }).map(function(r){
      return el("div", {}, [el("dt", { text: r[0] }), el("dd", {}, [r[1]])]);
    }));
  }
  function flashBox(text){ return text ? el("p", { class: "notice notice--ok admin-flash", text: text, attrs: { role: "status" } }) : null; }

  /* 資料庫還沒跑 sql/06_wishes.sql */
  function isSetupMissing(err){
    var c = err && err.cause, code = c && c.code, m = String((c && c.message) || "");
    return code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01" ||
           /does not exist|schema cache|Could not find/i.test(m);
  }
  function setupBox(){
    return el("div", { class: "notice notice--warn", attrs: { role: "alert" } }, [
      el("p", {}, [el("strong", { text: "許願牆的資料庫還沒設定" }),
        "請到 Supabase 後台 → SQL Editor 執行 sql/06_wishes.sql，再重新整理這一頁。"])
    ]);
  }
  function failBox(err){ return isSetupMissing(err) ? setupBox() : C.errorBox(err); }

  function keepOpen(det, key){
    det.addEventListener("toggle", function(){ if(det.open) openIds[key] = true; else delete openIds[key]; });
    if(openIds[key]) det.open = true;
    return det;
  }

  function setCounts(filtersEl, list, match){
    var c = {};
    Array.prototype.forEach.call(filtersEl.querySelectorAll("[data-filter]"), function(b){
      var f = b.getAttribute("data-filter");
      c[f] = list.filter(function(x){ return match(x, f); }).length;
      b.querySelector(".seg-count").textContent = c[f];
    });
    return c;
  }
  function markFilter(filtersEl, current){
    Array.prototype.forEach.call(filtersEl.querySelectorAll("[data-filter]"), function(b){
      b.setAttribute("aria-current", b.getAttribute("data-filter") === current ? "true" : "false");
    });
  }

  /* ============================================================
     願望
     ============================================================ */
  function wishMatch(w, f){ return f === "all" || w.status === f; }

  function contactText(c){
    c = c || {};
    var parts = [];
    if(c.email) parts.push(c.email);
    if(c.instagram) parts.push("IG @" + c.instagram);
    return parts.join("・") || "（沒有留）";
  }

  function reviewBlock(w){
    var noteId = "wish-note-" + w.id;
    var note = el("input", { class: "ctrl", attrs: { id: noteId, maxlength: "500",
      placeholder: w.status === "pending" ? "不通過時必填，許願者會看到" : "撤下時必填，許願者會看到" } });
    var msg = msgLine();
    function act(approve, b){
      var v = note.value.trim();
      if(!approve && !v){ say(msg, "請寫審核備註，許願者會看到。", true); note.focus(); return; }
      if(!approve && w.status === "open" && !confirm("撤下後，這個願望和下面的提案都不會再公開。確定嗎？")) return;
      b.disabled = true;
      say(msg, "處理中…");
      ArchDB.adminReviewWish(w.id, approve, v).then(function(){
        openIds["w" + w.id] = true;
        return loadWishes(approve ? "「" + W.wishTitle(w) + "」已公開到許願牆。" : "「" + W.wishTitle(w) + "」已改成不通過，許願者會看到審核備註。");
      }).catch(function(err){ b.disabled = false; say(msg, err.message, true); });
    }
    var buttons = w.status === "pending"
      ? [btn("公開", "", function(b){ act(true, b); }), btn("不通過", "btn--danger", function(b){ act(false, b); })]
      : [btn("撤下（改成未通過）", "btn--danger", function(b){ act(false, b); })];
    return el("div", { class: "admin-block" }, [
      el("h4", { text: w.status === "pending" ? "審核" : "撤下這個願望" }),
      el("div", { class: "review-actions" }, [
        el("div", { class: "field" }, [el("label", { class: "q", text: "審核備註", attrs: { for: noteId } }), note])
      ].concat(buttons)),
      msg
    ]);
  }

  function wishRow(w){
    var meta = [w.show_name ? (w.user_name || "（沒有顯示名稱）") : "匿名收藏家", W.occasionText(w), W.budgetText(w.budget_range), W.dateText(w.created_at)]
      .filter(Boolean).join("・");
    var summary = el("summary", {}, [
      el("div", { class: "row-main" }, [el("h3", { text: W.wishTitle(w) }), el("p", { text: meta })]),
      el("span", { class: "admin-badges" }, [W.statusBadge(w.status)])
    ]);
    var body = el("div", { class: "review-body" }, [
      facts([
        ["許願者", (w.user_name || "（沒有顯示名稱）") + (w.user_email ? "（" + w.user_email + "）" : "")],
        ["公開顯示", w.show_name ? "名字（" + (w.user_name || "沒有顯示名稱，會顯示匿名") + "）" : "匿名收藏家"],
        ["聯絡方式", contactText(w.contact) + "（不公開）"],
        ["場合", W.occasionText(w) || "—"],
        ["預算", W.budgetText(w.budget_range) || "—"],
        ["尺寸", w.size || "—"],
        ["題材", (w.tags || []).join("、") || "—"],
        ["提案", (w.proposal_count || 0) + " 則公開中" + (w.selected_count ? "，許願者選了 " + w.selected_count + " 則" : "")],
        ["許願日期", W.dateText(w.created_at)],
        w.review_note ? ["審核備註", w.review_note] : null
      ]),
      el("h4", { class: "admin-sub", text: "願望內容" }),
      el("p", { class: "quote", text: w.story || "" }),
      w.intro ? el("h4", { class: "admin-sub", text: "自我介紹（公開）" }) : null,
      w.intro ? el("p", { class: "quote", text: w.intro }) : null,
      w.status === "open" || w.status === "closed"
        ? el("div", { class: "btn-row" }, [el("a", { class: "btn btn--ghost btn--sm", href: W.wishHref(w), text: "看願望頁", attrs: { target: "_blank", rel: "noopener" } })])
        : null
    ]);
    if(w.status === "pending" || w.status === "open") body.appendChild(reviewBlock(w));
    return keepOpen(el("details", { class: "review", attrs: { "data-id": w.id } }, [summary, body]), "w" + w.id);
  }

  function renderWishes(){
    markFilter(wishFilters, wishFilter);
    var list = wishes.filter(function(w){ return wishMatch(w, wishFilter); });
    if(wishFilter === "pending") list.sort(function(x, y){ return String(x.created_at).localeCompare(String(y.created_at)); });   // 先送的排前面
    var nodes = [flashBox(wishFlash)];
    wishFlash = "";
    nodes = nodes.concat(list.length ? list.map(wishRow) : [C.emptyBox(WISH_EMPTY[wishFilter] || "沒有願望。")]);
    C.fill(wishList, nodes);
    var c = setCounts(wishFilters, wishes, wishMatch);
    var nav = document.querySelector('[data-slot="wishes-count"]');
    if(nav) nav.textContent = c.pending ? String(c.pending) : "";
  }

  function loadWishes(message){
    return ArchDB.adminWishes().then(function(list){
      wishes = list || [];
      wishFlash = message || "";
      renderWishes();
    }, function(err){
      C.fill(wishList, failBox(err));
      throw err;
    });
  }

  /* ============================================================
     提案
     ============================================================ */
  function propMatch(p, f){ return f === "all" || p.status === f; }

  function propRow(p){
    var a = p.artist || {}, w = p.wish || {};
    var name = a.name || "未命名畫家";
    var summary = el("summary", {}, [
      C.avatar({ name: name, portrait_url: a.portrait_url, works: [] }, "avatar"),
      el("div", { class: "row-main" }, [
        el("h3", { text: name }),
        el("p", { text: "對「" + W.wishTitle(w) + "」・" + W.dateText(p.created_at) })
      ]),
      el("span", { class: "admin-badges" }, [
        p.status === "hidden" ? el("span", { class: "status status--bad", text: "已隱藏" }) : el("span", { class: "status status--ok", text: "公開中" })
      ])
    ]);
    var msg = msgLine();
    var hidden = p.status === "hidden";
    var toggle = btn(hidden ? "取消隱藏（重新公開）" : "隱藏這則提案", hidden ? "" : "btn--danger", function(b){
      if(!hidden && !confirm("隱藏後，這則提案不會出現在願望頁，許願者也看不到。確定嗎？")) return;
      b.disabled = true;
      say(msg, "處理中…");
      ArchDB.adminHideProposal(p.id, !hidden).then(function(){
        openIds["p" + p.id] = true;
        return loadProposals(hidden ? name + "的提案已重新公開。" : name + "的提案已隱藏。");
      }).catch(function(err){ b.disabled = false; say(msg, err.message, true); });
    });
    var body = el("div", { class: "review-body" }, [
      facts([
        ["願望", W.wishTitle(w)],
        ["願望狀態", W.statusText(w.status)],
        ["畫家狀態", a.status === "approved" ? "已上架" : "沒有上架（提案不會公開）"],
        ["許願者選了", p.selected ? "是（只有管理者、許願者、這位畫家看得到）" : "還沒有"],
        ["提案時間", W.dateText(p.created_at)]
      ]),
      el("h4", { class: "admin-sub", text: "提案內容" }),
      el("p", { class: "quote", text: p.message || "" }),
      el("div", { class: "btn-row" }, [
        toggle,
        w.status === "open" || w.status === "closed"
          ? el("a", { class: "btn btn--ghost btn--sm", href: W.wishHref(w), text: "看願望頁", attrs: { target: "_blank", rel: "noopener" } }) : null,
        a.status === "approved" && a.slug
          ? el("a", { class: "btn btn--ghost btn--sm", href: "artist.html?slug=" + encodeURIComponent(a.slug), text: "看畫家頁", attrs: { target: "_blank", rel: "noopener" } }) : null
      ]),
      msg
    ]);
    return keepOpen(el("details", { class: "review", attrs: { "data-id": p.id } }, [summary, body]), "p" + p.id);
  }

  function renderProposals(){
    markFilter(propFilters, propFilter);
    var list = proposals.filter(function(p){ return propMatch(p, propFilter); });
    var nodes = [flashBox(propFlash)];
    propFlash = "";
    nodes = nodes.concat(list.length ? list.map(propRow) : [C.emptyBox(PROP_EMPTY[propFilter] || "沒有提案。")]);
    C.fill(propList, nodes);
    setCounts(propFilters, proposals, propMatch);
  }

  function loadProposals(message){
    return ArchDB.adminProposals().then(function(list){
      proposals = list || [];
      propFlash = message || "";
      renderProposals();
    }, function(err){
      C.fill(propList, failBox(err));
      throw err;
    });
  }

  /* ============================================================
     篩選、重新整理、進入頁面
     ============================================================ */
  wishFilters.addEventListener("click", function(e){
    var b = e.target.closest("[data-filter]");
    if(!b) return;
    wishFilter = b.getAttribute("data-filter");
    renderWishes();
  });
  propFilters.addEventListener("click", function(e){
    var b = e.target.closest("[data-filter]");
    if(!b) return;
    propFilter = b.getAttribute("data-filter");
    renderProposals();
  });
  var reloadBtn = document.querySelector('[data-action="reload-wishes"]');
  if(reloadBtn) reloadBtn.addEventListener("click", function(){
    C.fill(wishList, el("p", { class: "muted", text: "正在讀取願望…" }));
    C.fill(propList, el("p", { class: "muted", text: "正在讀取提案…" }));
    loadWishes().catch(function(){});
    loadProposals().catch(function(){});
  });

  ArchAuth.ready.then(function(me){
    if(!me || !me.is_admin) return;                  // admin.js 會處理導向
    loadWishes().then(function(){
      // 沒有待審核的願望時，直接看徵求中的
      if(!wishes.some(function(w){ return w.status === "pending"; }) && wishes.length){
        wishFilter = wishes.some(function(w){ return w.status === "open"; }) ? "open" : "all";
        renderWishes();
      }
    }).catch(function(){});
    loadProposals().catch(function(){});
  });
})();
