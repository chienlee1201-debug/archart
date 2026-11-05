/* ============================================================
   admin.js — 管理後台（admin.html）
   需要先載入：config.js、supabase-js、db.js、auth.js、ui.js、cards.js

   · 需要登入且是管理者（arch_me 的 is_admin）；不是的人導回首頁
   · 「畫家」分頁接資料庫（sql/02_artists.sql）：
       依狀態篩選（待審核／修改待審／已上架／需修改／草稿／還沒認領／全部）
       每位：編輯（studio.html?artist=id）、看公開頁
       還沒認領：複製認領連結、重新產生連結、綁定帳號（輸入 Google 信箱）
       審核新申請：核准上架／退回修改（備註必填）
       審核修改：列出改了哪些欄位、作品新增／刪除／修改，核准／退回（備註必填）
   · 總覽、願望、提案、問卷、會員：還是示範畫面（之後的階段再接）
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards;
  if(!C || !window.ArchDB || !window.ArchAuth) return;
  var el = C.el;

  var STATUS = {
    draft: ["草稿", ""], pending: ["待審核", "warn"], approved: ["已上架", "ok"], needs_changes: ["需修改", "bad"]
  };
  var REV_STATUS = { draft: "修改中（還沒送出）", pending: "修改待審", rejected: "修改被退回" };
  var REFERRAL = { threads: "Threads", instagram: "Instagram", friend: "朋友介紹", other: "其他" };
  var WORK_STATUS = { available: "可購買", sold: "已售出", not_for_sale: "非賣品" };
  var EMPTY = {
    pending: "沒有待審核的新申請。", revision: "沒有待審核的修改。", approved: "還沒有上架的畫家。",
    needs_changes: "沒有需修改的畫家。", draft: "沒有草稿。", unclaimed: "所有畫家都認領了。", all: "還沒有任何畫家。"
  };

  var listEl = document.querySelector('[data-slot="artist-list"]');
  var filtersEl = document.querySelector('[data-slot="artist-filters"]');
  var artists = [];
  var filter = "pending";
  var openIds = {};                  // 重新整理清單時，保持原本展開的那幾位

  function fmtDate(s){
    if(!s) return "";
    var d = new Date(s);
    return isNaN(d) ? "" : (d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate());
  }
  function statusBadge(st){
    var s = STATUS[st] || [st, ""];
    return el("span", { class: "status" + (s[1] ? " status--" + s[1] : ""), text: s[0] });
  }
  function claimUrl(token){
    return new URL("claim.html?token=" + encodeURIComponent(token), location.href).href;
  }
  function btn(text, cls, onClick){
    var b = el("button", { class: "btn btn--sm " + (cls || ""), text: text, attrs: { type: "button" } });
    if(onClick) b.addEventListener("click", function(){ onClick(b); });
    return b;
  }
  function msgLine(){ return el("p", { class: "admin-msg", attrs: { role: "status", "aria-live": "polite" } }); }
  function say(n, text, bad){ n.textContent = text || ""; n.className = "admin-msg" + (bad ? " is-bad" : ""); }

  function matches(a, f){
    if(f === "all") return true;
    if(f === "revision") return !!(a.revision && a.revision.status === "pending");
    if(f === "unclaimed") return !a.claimed;
    return a.status === f;
  }

  /* ============================================================
     認領：連結、重新產生、綁定帳號
     ============================================================ */
  function claimBlock(a){
    var box = el("div", { class: "admin-block" }, [el("h4", { text: "認領" })]);
    var msg = msgLine();

    if(a.edit_token){
      var url = claimUrl(a.edit_token);
      var input = el("input", { class: "ctrl", attrs: { readonly: "", "aria-label": a.name + " 的認領連結", value: url } });
      input.addEventListener("focus", function(){ input.select(); });
      box.appendChild(el("p", { class: "muted small", text: "把這個連結私訊給畫家，對方打開、用 Google 登入就完成認領。連結只能用一次。" }));
      box.appendChild(el("div", { class: "copy-row" }, [
        input,
        btn("複製認領連結", "", function(){
          var done = function(){ say(msg, "已複製。"); };
          if(navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(url).then(done, function(){ input.focus(); input.select(); say(msg, "沒辦法自動複製，連結已經選起來，請按 ⌘C／Ctrl+C。"); });
          }else{ input.focus(); input.select(); say(msg, "請按 ⌘C／Ctrl+C 複製。"); }
        })
      ]));
    }else{
      box.appendChild(el("p", { class: "muted small", text: "目前沒有認領連結。按「重新產生連結」做一個新的。" }));
    }

    var actions = el("div", { class: "btn-row" }, [
      btn(a.edit_token ? "重新產生連結" : "產生認領連結", "btn--light", function(b){
        if(a.edit_token && !confirm("重新產生後，舊的認領連結會立刻失效。確定嗎？")) return;
        b.disabled = true;
        ArchDB.adminNewClaimToken(a.id).then(function(){
          openIds[a.id] = true;
          return reload("已產生新的認領連結。");
        }).catch(function(err){ b.disabled = false; say(msg, err.message, true); });
      })
    ]);
    box.appendChild(actions);

    /* 綁定帳號：輸入對方登入用的 Google 信箱 */
    var emailId = "bind-" + a.id;
    var email = el("input", { class: "ctrl", attrs: { type: "email", id: emailId, placeholder: "例如 painter@gmail.com", autocomplete: "off" } });
    var conflict = el("div", { class: "bind-conflict", attrs: { hidden: "" } });
    function bind(replaceId, b){
      var v = email.value.trim();
      if(!v){ say(msg, "請輸入對方登入用的 Google 信箱。", true); email.focus(); return; }
      b.disabled = true;
      say(msg, "綁定中…");
      ArchDB.adminBindArtist(a.id, v, replaceId).then(function(r){
        if(r && r.result === "conflict"){
          b.disabled = false;
          say(msg, "");
          showConflict(r.other);
          return;
        }
        openIds[a.id] = true;
        return reload("已把「" + (a.name || "這位畫家") + "」綁定到 " + v + "。");
      }).catch(function(err){ b.disabled = false; say(msg, err.message, true); });
    }
    function showConflict(o){
      var st = (STATUS[o.status] || [o.status])[0];
      C.fill(conflict, [
        el("p", { text: "這個帳號已經有一個畫家頁：「" + (o.name || "未命名") + "」（" + st + "，" + o.works + " 件作品，" + fmtDate(o.created_at) + " 建立）。" }),
        el("p", { text: "要綁定的話，得先刪掉那一個。刪掉後無法復原，它的作品、收到的詢問、提案會一起刪除。" }),
        el("div", { class: "btn-row" }, [
          btn("刪掉「" + (o.name || "未命名") + "」並綁定", "btn--danger", function(b){
            if(!confirm("確定要刪掉「" + (o.name || "未命名") + "」，再把帳號綁到「" + (a.name || "這位畫家") + "」嗎？刪掉後無法復原。")) return;
            bind(o.id, b);
          }),
          btn("先不要", "btn--light", function(){ conflict.hidden = true; })
        ])
      ]);
      conflict.hidden = false;
    }
    var bindBtn = btn("綁定", "", function(b){ conflict.hidden = true; bind(null, b); });
    box.appendChild(el("div", { class: "field bind-field" }, [
      el("label", { class: "q", text: "綁定帳號（備案）", attrs: { for: emailId } }),
      el("span", { class: "hint", text: "畫家沒辦法用連結認領時，輸入他登入 Arch 用的 Google 信箱（對方要先登入過一次）。" }),
      el("div", { class: "copy-row" }, [email, bindBtn])
    ]));
    box.appendChild(conflict);
    box.appendChild(msg);
    return box;
  }

  /* ============================================================
     審核新申請
     ============================================================ */
  function thumbs(works){
    var list = (works || []).filter(function(w){ return w.image_url; });
    if(!list.length) return el("p", { class: "muted small", text: "還沒有作品圖片。" });
    return el("div", { class: "admin-thumbs" }, list.map(function(w){
      var box = el("div", { class: "admin-thumb", attrs: { title: C.workTitle(w) } });
      var img = el("img", { attrs: { alt: "〈" + C.workTitle(w) + "〉", loading: "lazy", decoding: "async" } });
      img.onerror = function(){ img.remove(); };
      img.src = w.image_url;
      box.appendChild(img);
      return box;
    }));
  }

  function reviewForm(id, placeholder, onApprove, onReject, approveText){
    var noteId = "note-" + id;
    var note = el("input", { class: "ctrl", attrs: { id: noteId, placeholder: placeholder, maxlength: "500" } });
    var msg = msgLine();
    function act(approve, b){
      var v = note.value.trim();
      if(!approve && !v){ say(msg, "退回修改時請寫審核備註，畫家會看到。", true); note.focus(); return; }
      b.disabled = true;
      say(msg, "處理中…");
      (approve ? onApprove : onReject)(v).catch(function(err){ b.disabled = false; say(msg, err.message, true); });
    }
    return el("div", {}, [
      el("div", { class: "review-actions" }, [
        el("div", { class: "field" }, [el("label", { class: "q", text: "審核備註", attrs: { for: noteId } }), note]),
        btn(approveText, "", function(b){ act(true, b); }),
        btn("退回修改", "btn--danger", function(b){ act(false, b); })
      ]),
      msg
    ]);
  }

  function applicationBlock(a){
    var box = el("div", { class: "admin-block" }, [el("h4", { text: "審核新申請" })]);
    var tags = C.tagList(a.tags);
    if(tags) box.appendChild(tags);
    box.appendChild(a.story ? el("p", { class: "quote", text: a.story }) : el("p", { class: "muted small", text: "沒有寫創作故事。" }));
    box.appendChild(thumbs(a.works));
    box.appendChild(reviewForm(a.id, "退回修改時必填，畫家會看到",
      function(note){
        return ArchDB.adminReviewArtist(a.id, true, note).then(function(){ return reload("「" + a.name + "」已上架。"); });
      },
      function(note){
        return ArchDB.adminReviewArtist(a.id, false, note).then(function(){ return reload("已退回「" + a.name + "」，畫家會看到審核備註。"); });
      }, "核准上架"));
    return box;
  }

  /* ============================================================
     審核修改：比對網站上的版本與送審版本
     ============================================================ */
  var FIELDS = [
    ["name", "姓名"], ["slug", "網址"], ["tags", "風格標籤"], ["tagline", "一句話介紹"], ["story", "創作故事"],
    ["portrait_url", "頭像"], ["email", "公開 Email"], ["instagram", "Instagram"], ["custom_ok", "接受客製"], ["custom_note", "客製說明"]
  ];
  var WORK_FIELDS = [
    ["title", "名稱"], ["image_url", "圖片"], ["medium", "媒材"], ["support", "畫在什麼上"], ["width_cm", "寬"], ["height_cm", "高"],
    ["price_min", "價格"], ["price_max", "價格上限"], ["status", "狀態"], ["year", "年份"], ["description", "作品說明"]
  ];
  var NUMERIC = { width_cm: 1, height_cm: 1, price_min: 1, price_max: 1, year: 1 };

  function norm(k, v){
    if(v == null || v === "") return "";
    if(Array.isArray(v)) return v.join("、");
    if(k === "custom_ok") return v ? "接受" : "暫不接受";
    if(k === "status") return WORK_STATUS[v] || String(v);
    if(NUMERIC[k]) return isNaN(Number(v)) ? String(v) : String(Number(v));
    return String(v);
  }
  function show(v){ return v === "" ? "（空白）" : v; }
  function shorten(v){ return v.length > 80 ? v.slice(0, 80) + "…" : v; }

  function imgPair(oldUrl, newUrl){
    function one(u){
      var box = el("span", { class: "admin-thumb admin-thumb--sm" });
      if(u){ var img = el("img", { attrs: { alt: "", loading: "lazy" } }); img.onerror = function(){ img.remove(); }; img.src = u; box.appendChild(img); }
      return box;
    }
    if(!oldUrl || !newUrl) return (oldUrl || newUrl) ? el("span", { class: "diff-imgs" }, [one(oldUrl || newUrl)]) : null;   // 新增／刪除：只放一張
    return el("span", { class: "diff-imgs" }, [one(oldUrl), el("span", { text: "→", attrs: { "aria-hidden": "true" } }), one(newUrl)]);
  }

  function diffList(d){
    var live = d.artist, works = d.works || [], rev = d.revision && d.revision.data;
    if(!rev) return el("p", { class: "muted small", text: "讀不到送審內容。" });
    var items = [];

    FIELDS.forEach(function(f){
      var k = f[0], o = norm(k, live[k]), n = norm(k, rev[k]);
      if(o === n) return;
      if(k === "portrait_url"){
        items.push(el("li", {}, [el("strong", { text: f[1] + "：" }), "換了新的", imgPair(live[k], rev[k])]));
      }else if(k === "story"){
        items.push(el("li", {}, [el("strong", { text: f[1] + "：" }), "有修改",
          el("details", { class: "diff-more" }, [el("summary", { text: "看新的創作故事" }), el("p", { class: "quote", text: show(n) })])]));
      }else{
        items.push(el("li", {}, [el("strong", { text: f[1] + "：" }), el("span", { class: "diff-old", text: shorten(show(o)) }), " → ", el("span", { class: "diff-new", text: shorten(show(n)) })]));
      }
    });

    var liveById = {};
    works.forEach(function(w){ liveById[w.id] = w; });
    var kept = [];
    (rev.works || []).forEach(function(w, i){
      var t = "作品 " + (i + 1) + "〈" + C.workTitle(w) + "〉";
      var old = w.id && liveById[w.id];
      if(!old){
        items.push(el("li", {}, [el("strong", { class: "diff-add", text: "新增 " }), t, imgPair(null, w.image_url)]));
        return;
      }
      kept.push(w.id);
      var changes = [];
      var imgChanged = false;
      WORK_FIELDS.forEach(function(f){
        var k = f[0], o = norm(k, old[k]), n = norm(k, w[k]);
        if(o === n) return;
        if(k === "image_url"){ imgChanged = true; changes.push("圖片"); }
        else if(k === "description") changes.push("作品說明");
        else changes.push(f[1] + " " + shorten(show(o)) + " → " + shorten(show(n)));
      });
      if(changes.length){
        items.push(el("li", {}, [el("strong", { text: "修改 " }), t + "：" + changes.join("；"), imgChanged ? imgPair(old.image_url, w.image_url) : null]));
      }
    });
    works.forEach(function(w){
      if(kept.indexOf(w.id) < 0){
        items.push(el("li", {}, [el("strong", { class: "diff-del", text: "刪除 " }), "〈" + C.workTitle(w) + "〉", imgPair(w.image_url, null)]));
      }
    });
    var liveOrder = works.map(function(w){ return w.id; }).filter(function(id){ return kept.indexOf(id) > -1; });
    if(liveOrder.join() !== kept.join()) items.push(el("li", {}, [el("strong", { text: "作品順序" }), "有調整（第一件是封面）"]));

    if(!items.length) return el("p", { class: "muted small", text: "沒有偵測到內容變動。" });
    return el("ul", { class: "diff-list" }, items);
  }

  function revisionBlock(a){
    var r = a.revision;
    var box = el("div", { class: "admin-block" }, [el("h4", { text: "審核修改" })]);
    box.appendChild(el("p", { class: "muted small", text: "網站上目前是舊版；核准後才會換成新的。送出時間：" + (fmtDate(r.submitted_at) || "—") }));
    var diffBox = el("div", { class: "diff-box" }, [el("p", { class: "muted small", text: "正在比對修改內容…" })]);
    box.appendChild(diffBox);
    box.appendChild(reviewForm("rev-" + r.id, "退回修改時必填，畫家會看到",
      function(note){
        return ArchDB.adminReviewRevision(r.id, true, note).then(function(){ return reload("已核准「" + a.name + "」的修改，網站上已經更新。"); });
      },
      function(note){
        return ArchDB.adminReviewRevision(r.id, false, note).then(function(){ return reload("已退回「" + a.name + "」的修改，網站上維持舊版。"); });
      }, "核准修改"));
    box.__loadDiff = function(){
      if(box.__loaded) return;
      box.__loaded = true;
      ArchDB.studioLoad(a.id).then(function(d){
        C.fill(diffBox, diffList(d));
      }).catch(function(err){
        box.__loaded = false;
        C.fill(diffBox, el("p", { class: "admin-msg is-bad", text: "比對失敗：" + err.message }));
      });
    };
    return box;
  }

  /* ============================================================
     每一位畫家
     ============================================================ */
  function facts(a){
    var rows = [
      ["網址", a.slug ? "artist.html?slug=" + a.slug : "（還沒填）"],
      ["帳號", a.claimed ? (a.owner_email || a.owner_name || "已綁定") + (a.claimed_at ? "（" + fmtDate(a.claimed_at) + " 認領）" : "") : "還沒認領"],
      ["來源", REFERRAL[a.referral_source] || "—"],
      ["作品", (a.works || []).length + " 件"],
      ["排序", String(a.sort_order)],
      ["建立", fmtDate(a.created_at)]
    ];
    if(a.admin_edited_at) rows.push(["管理者改過", fmtDate(a.admin_edited_at) + "（demo 同步會跳過）"]);
    if(a.review_note) rows.push(["審核備註", a.review_note]);
    if(a.revision && a.revision.status !== "pending") rows.push(["修改", REV_STATUS[a.revision.status] + (a.revision.review_note ? "：" + a.revision.review_note : "")]);
    return el("dl", { class: "admin-facts" }, rows.map(function(r){
      return el("div", {}, [el("dt", { text: r[0] }), el("dd", { text: r[1] })]);
    }));
  }

  function artistRow(a){
    var name = a.name || "未命名畫家";
    var meta = [a.tagline, REFERRAL[a.referral_source] ? "來源：" + REFERRAL[a.referral_source] : "",
                a.claimed ? "已認領" : "還沒認領", fmtDate(a.created_at)].filter(Boolean).join("・");
    var badges = el("span", { class: "admin-badges" }, [
      statusBadge(a.status),
      a.revision && a.revision.status === "pending" ? el("span", { class: "status status--warn", text: "修改待審" }) : null
    ]);
    var summary = el("summary", {}, [
      C.avatar({ name: name, portrait_url: a.portrait_url, works: a.works }, "avatar"),
      el("div", { class: "row-main" }, [el("h3", { text: name }), el("p", { text: meta })]),
      badges
    ]);

    var links = el("div", { class: "btn-row" }, [
      el("a", { class: "btn btn--sm", href: "studio.html?artist=" + encodeURIComponent(a.id), text: "編輯" }),
      a.status === "approved" && a.slug
        ? el("a", { class: "btn btn--ghost btn--sm", href: "artist.html?slug=" + encodeURIComponent(a.slug), text: "看公開頁", attrs: { target: "_blank", rel: "noopener" } })
        : null
    ]);

    var body = el("div", { class: "review-body" }, [facts(a), links]);
    var rev = null;
    if(a.status === "pending") body.appendChild(applicationBlock(a));
    if(a.revision && a.revision.status === "pending"){ rev = revisionBlock(a); body.appendChild(rev); }
    if(!a.claimed) body.appendChild(claimBlock(a));

    var det = el("details", { class: "review", attrs: { "data-id": a.id } }, [summary, body]);
    det.addEventListener("toggle", function(){
      if(det.open){ openIds[a.id] = true; if(rev) rev.__loadDiff(); }
      else delete openIds[a.id];
    });
    if(openIds[a.id]){ det.open = true; if(rev) rev.__loadDiff(); }
    return det;
  }

  /* ============================================================
     清單、篩選
     ============================================================ */
  function counts(){
    var c = {};
    Array.prototype.forEach.call(filtersEl.querySelectorAll("[data-filter]"), function(b){
      var f = b.getAttribute("data-filter");
      c[f] = artists.filter(function(a){ return matches(a, f); }).length;
      b.querySelector(".seg-count").textContent = c[f];
    });
    var todo = (c.pending || 0) + (c.revision || 0);
    var nav = document.querySelector('[data-slot="artists-count"]');
    if(nav) nav.textContent = todo ? String(todo) : "";
  }

  var flash = "";
  function render(){
    Array.prototype.forEach.call(filtersEl.querySelectorAll("[data-filter]"), function(b){
      b.setAttribute("aria-current", b.getAttribute("data-filter") === filter ? "true" : "false");
    });
    var list = artists.filter(function(a){ return matches(a, filter); });
    if(filter === "pending" || filter === "revision"){
      list.sort(function(x, y){     // 待審：先送的排前面
        var tx = filter === "revision" ? x.revision.submitted_at : x.updated_at;
        var ty = filter === "revision" ? y.revision.submitted_at : y.updated_at;
        return String(tx).localeCompare(String(ty));
      });
    }
    var nodes = [];
    if(flash) nodes.push(el("p", { class: "notice notice--ok admin-flash", text: flash, attrs: { role: "status" } }));
    flash = "";
    nodes = nodes.concat(list.length ? list.map(artistRow) : [C.emptyBox(EMPTY[filter] || "沒有畫家。")]);
    C.fill(listEl, nodes);
    counts();
  }

  function reload(message){
    return ArchDB.adminArtists().then(function(list){
      artists = list || [];
      flash = message || "";
      render();
    }, function(err){
      C.fill(listEl, C.errorBox(err));
      throw err;
    });
  }

  filtersEl.addEventListener("click", function(e){
    var b = e.target.closest("[data-filter]");
    if(!b) return;
    filter = b.getAttribute("data-filter");
    render();
  });
  document.querySelector('[data-action="reload-artists"]').addEventListener("click", function(){
    C.fill(listEl, el("p", { class: "muted", text: "正在讀取畫家…" }));
    reload().catch(function(){});
  });

  /* ============================================================
     進入頁面：確認是管理者
     ============================================================ */
  ArchAuth.requirePage().then(function(me){
    if(!me) return;                                       // 已經被送去登入頁
    if(!me.is_admin){ location.replace("index.html"); return; }
    document.querySelector('[data-slot="admin-loading"]').hidden = true;
    document.querySelector('[data-slot="admin-body"]').hidden = false;
    reload().then(function(){
      // 沒有待審核的新申請、但有修改待審時，直接切到修改待審
      if(!artists.some(function(a){ return matches(a, "pending"); }) && artists.some(function(a){ return matches(a, "revision"); })){
        filter = "revision";
        render();
      }
      if(location.hash){
        var t = document.getElementById(location.hash.slice(1));
        if(t) t.scrollIntoView();
      }
    }).catch(function(){});
  });
})();
