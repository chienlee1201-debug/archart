/* ============================================================
   admin.js — 管理後台（admin.html）
   需要先載入：config.js、images.js、supabase-js、db.js、auth.js、ui.js、cards.js

   · 需要登入且是管理者（arch_me 的 is_admin）；不是的人導回首頁
   · 「畫家」分頁接資料庫（sql/02_artists.sql）：
       依狀態篩選（待審核／修改待審／已上架／需修改／草稿／還沒認領／全部）
       每位：編輯（studio.html?artist=id）、看公開頁
       還沒認領：複製認領連結、重新產生連結、綁定帳號（輸入 Google 信箱）
       審核新申請：核准上架／退回修改（備註必填）
       審核修改：列出改了哪些欄位、作品新增／刪除／修改，核准／退回（備註必填）
   · 「首頁精選」分頁（sql/03_featured.sql）：從已上架畫家選最多 6 位、上下調順序、儲存；
       還沒設定過時，先帶入首頁目前自動顯示的 6 位（排序最前面）
   · 「工具」分頁：補產生縮圖（一次性，可重複按；sql/04_thumbs.sql）
       收集所有頭像、作品圖（含審核中修改裡的圖）→ 已經有縮圖就跳過 → 沒有就下載原圖、縮成 800px JPG、上傳到縮圖路徑
   · 總覽、願望、提案、問卷、會員：還是示範畫面（之後的階段再接）
   · 這頁的作品圖、頭像都用縮圖（js/images.js）
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
  var featSaved = null;              // 已儲存的精選 id（依順序）；null = 讀不到
  var featErr = null;                // 讀精選名單的錯誤（例如還沒執行 sql/03_featured.sql）

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
      C.thumb(img, w.image_url);
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
    ["portrait_url", "頭像"], ["email", "公開 Email"], ["instagram", "Instagram"], ["location", "我的位置"], ["custom_ok", "接受客製"], ["custom_note", "客製說明"]
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
      if(u){ var img = el("img", { attrs: { alt: "", loading: "lazy" } }); img.onerror = function(){ img.remove(); }; C.thumb(img, u); box.appendChild(img); }
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
      ["網址", a.slug ? "artist.html?slug=" + a.slug : "（送出審核時自動產生）"],
      ["位置", a.location || "—"],
      ["帳號", a.claimed ? (a.owner_email || a.owner_name || "已綁定") + (a.claimed_at ? "（" + fmtDate(a.claimed_at) + " 認領）" : "") : "還沒認領"],
      ["來源", REFERRAL[a.referral_source] || "—"],
      ["作品", (a.works || []).length + " 件"],
      ["排序", String(a.sort_order)],
      ["首頁精選", featSaved && featSaved.indexOf(a.id) > -1 ? "第 " + (featSaved.indexOf(a.id) + 1) + " 位" : "—"],
      ["建立", fmtDate(a.created_at)]
    ];
    if(a.admin_edited_at) rows.push(["管理者改過", fmtDate(a.admin_edited_at)]);
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
     首頁精選畫家
     ============================================================ */
  var FEAT_MAX = 6;
  var featEl = document.querySelector('[data-slot="featured-admin"]');
  var featDraft = null;              // 正在編輯的名單（id 陣列）；null = 還沒開始編輯
  var featMsg = "";                  // 儲存後的提示

  function approvedList(){
    return artists.filter(function(a){ return a.status === "approved"; }).sort(function(x, y){
      return (x.sort_order - y.sort_order) || String(x.created_at).localeCompare(String(y.created_at));
    });
  }
  /* 首頁現在實際顯示的名單：有設定精選 → 精選；沒有 → 排序最前面的 6 位（和 js/home.js 一樣） */
  function featBase(){
    var ok = {};
    approvedList().forEach(function(a){ ok[a.id] = true; });
    var saved = (featSaved || []).filter(function(id){ return ok[id]; });
    if(saved.length) return saved;
    return approvedList().slice(0, FEAT_MAX).map(function(a){ return a.id; });
  }
  function isSetupMissing(err){
    var c = err && err.cause, code = c && c.code, m = String((c && c.message) || "");
    return code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883" ||
           /does not exist|schema cache|Could not find/i.test(m);
  }
  function setupBox(){
    return el("div", { class: "notice notice--warn", attrs: { role: "alert" } }, [
      el("p", {}, [el("strong", { text: "精選功能的資料庫還沒設定" }),
        "請到 Supabase 後台 → SQL Editor 執行 sql/03_featured.sql，再重新整理這一頁。首頁在設定好之前，照舊自動顯示排序最前面的 6 位。"])
    ]);
  }

  function renderFeatured(){
    if(!featEl) return;
    if(featErr){
      C.fill(featEl, isSetupMissing(featErr) ? setupBox() : C.errorBox(featErr));
      return;
    }
    var byId = {};
    approvedList().forEach(function(a){ byId[a.id] = a; });
    var base = featBase();
    if(!featDraft) featDraft = base.slice();
    featDraft = featDraft.filter(function(id){ return byId[id]; });    // 被取消上架的人自動拿掉
    var changed = featDraft.join() !== base.join();
    var hasSaved = !!(featSaved && featSaved.some(function(id){ return byId[id]; }));
    var nodes = [];

    if(featMsg) nodes.push(el("p", { class: "notice notice--ok admin-flash", text: featMsg, attrs: { role: "status" } }));
    featMsg = "";
    nodes.push(el("p", { class: "muted small feat-state", text: hasSaved
      ? "首頁目前顯示你選的 " + base.length + " 位。"
      : "還沒設定精選，首頁目前自動顯示排序最前面的 " + base.length + " 位（下面先帶入這幾位）。改好按「儲存」，首頁就會固定顯示你選的畫家。" }));

    /* 已選的名單 */
    function move(i, d){
      var j = i + d;
      if(j < 0 || j >= featDraft.length) return;
      var t = featDraft[i]; featDraft[i] = featDraft[j]; featDraft[j] = t;
      renderFeatured();
      var row = featEl.querySelectorAll(".feat-item")[j];
      var again = row && row.querySelector(d < 0 ? "[data-move='up']" : "[data-move='down']");
      if(again && !again.disabled) again.focus();
      else if(row) row.querySelector("button").focus();
    }
    if(featDraft.length){
      nodes.push(el("ol", { class: "feat-list" }, featDraft.map(function(id, i){
        var a = byId[id], name = a.name || "未命名畫家";
        var up = btn("↑", "btn--light feat-move", function(){ move(i, -1); });
        up.setAttribute("aria-label", "把「" + name + "」往前移");
        up.setAttribute("data-move", "up");
        up.disabled = i === 0;
        var down = btn("↓", "btn--light feat-move", function(){ move(i, 1); });
        down.setAttribute("aria-label", "把「" + name + "」往後移");
        down.setAttribute("data-move", "down");
        down.disabled = i === featDraft.length - 1;
        var rm = btn("移除", "btn--light", function(){
          featDraft.splice(i, 1);
          renderFeatured();
          var sel = featEl.querySelector("select");
          if(sel) sel.focus();
        });
        rm.setAttribute("aria-label", "把「" + name + "」從精選移除");
        return el("li", { class: "feat-item" }, [
          el("span", { class: "feat-no", text: String(i + 1), attrs: { "aria-hidden": "true" } }),
          C.avatar({ name: name, portrait_url: a.portrait_url, works: a.works }, "avatar"),
          el("span", { class: "feat-name" }, [
            el("strong", { text: name }),
            el("span", { class: "muted small", text: a.tagline || (a.slug ? "artist.html?slug=" + a.slug : "") })
          ]),
          el("span", { class: "feat-actions" }, [up, down, rm])
        ]);
      })));
    }else{
      nodes.push(C.emptyBox("目前沒有選任何畫家。這樣儲存的話，首頁會改回自動顯示排序最前面的 6 位。"));
    }

    /* 加入畫家 */
    var left = approvedList().filter(function(a){ return featDraft.indexOf(a.id) < 0; })
      .sort(function(x, y){ return String(x.name || "").localeCompare(String(y.name || ""), "zh-Hant"); });
    var full = featDraft.length >= FEAT_MAX;
    var sel = el("select", { class: "ctrl", attrs: { id: "feat-add" } },
      [el("option", { text: full ? "已經選滿 " + FEAT_MAX + " 位" : (left.length ? "選一位已上架的畫家" : "已上架的畫家都選了"), attrs: { value: "" } })]
        .concat(left.map(function(a){ return el("option", { text: a.name || "未命名畫家", attrs: { value: a.id } }); })));
    sel.disabled = full || !left.length;
    var addMsg = msgLine();
    var add = btn("加入精選", "", function(){
      if(!sel.value){ say(addMsg, "請先選一位畫家。", true); sel.focus(); return; }
      featDraft.push(sel.value);
      renderFeatured();
      var s2 = featEl.querySelector("select");
      if(s2 && !s2.disabled) s2.focus();
    });
    add.disabled = sel.disabled;
    nodes.push(el("div", { class: "field feat-add" }, [
      el("label", { class: "q", text: "加入畫家", attrs: { for: "feat-add" } }),
      el("span", { class: "hint", text: full
        ? "已經選滿 " + FEAT_MAX + " 位，要換人請先移除一位。"
        : "建議選滿 " + FEAT_MAX + " 位：電腦版一排 3 張，剛好兩排。" }),
      el("div", { class: "copy-row" }, [sel, add]),
      addMsg
    ]));

    /* 儲存／復原 */
    var msg = msgLine();
    if(changed) say(msg, "有修改還沒儲存。", true);
    var save = btn(featDraft.length ? "儲存，更新首頁" : "儲存，首頁改回自動", "", function(b){
      if(!featDraft.length && hasSaved && !confirm("清空精選後，首頁會改回自動顯示排序最前面的 6 位。確定嗎？")) return;
      b.disabled = true;
      say(msg, "儲存中…");
      ArchDB.adminSetFeatured(featDraft.slice()).then(function(ids){
        featSaved = ids || [];
        featDraft = null;
        featMsg = featSaved.length ? "已儲存，首頁的精選畫家已經更新。" : "已清除精選，首頁改回自動顯示排序最前面的 6 位。";
        renderFeatured();
        render();                                          // 畫家清單的「首頁精選」欄位跟著更新
      }).catch(function(err){
        b.disabled = false;
        if(isSetupMissing(err)){ featErr = err; renderFeatured(); return; }
        say(msg, err.message, true);
      });
    });
    var undo = btn("復原", "btn--light", function(){ featDraft = null; renderFeatured(); });
    undo.disabled = !changed;
    nodes.push(el("div", { class: "btn-row feat-save" }, [
      save,
      undo,
      el("a", { class: "btn btn--ghost btn--sm", href: "index.html#featured", text: "看首頁", attrs: { target: "_blank", rel: "noopener" } })
    ]));
    nodes.push(msg);
    C.fill(featEl, nodes);
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
    var feat = ArchDB.getFeatured().then(function(ids){ featSaved = ids || []; featErr = null; }, function(err){ featSaved = null; featErr = err; });
    return Promise.all([ArchDB.adminArtists(), feat]).then(function(r){
      artists = r[0] || [];
      flash = message || "";
      render();
      renderFeatured();
    }, function(err){
      C.fill(listEl, C.errorBox(err));
      if(featEl) C.fill(featEl, C.errorBox(err));
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
     工具：補產生縮圖（js/images.js 的命名規則：大圖路徑去副檔名＋-s.jpg）
     · 只處理正式版 arch-images 的圖；一次 3 張；已經有縮圖（Storage 資料夾裡有那個檔名）就跳過
     · 上傳到別人的資料夾、demo/uploads/ 需要 sql/04_thumbs.sql 的管理者權限；被擋下會提示去執行
     ============================================================ */
  var THUMB_SIDE = 800, THUMB_QUALITY = 0.8, THUMB_PARALLEL = 3;
  var thumbBtn = document.querySelector('[data-action="make-thumbs"]');
  var thumbMsg = document.querySelector('[data-slot="thumbs-progress"]');
  var thumbOut = document.querySelector('[data-slot="thumbs-result"]');

  function warnLeave(e){ e.preventDefault(); e.returnValue = ""; }

  /* 所有圖片網址（不重複）：頭像、作品；有修改（修改中／待審／被退回）的畫家，再讀那份修改裡的圖 */
  function collectImageUrls(){
    var urls = [];
    function add(u){ if(u && urls.indexOf(u) < 0) urls.push(u); }
    artists.forEach(function(a){
      add(a.portrait_url);
      (a.works || []).forEach(function(w){ add(w.image_url); });
    });
    return artists.filter(function(a){ return a.revision; }).reduce(function(p, a){
      return p.then(function(){
        return ArchDB.studioLoad(a.id).then(function(d){
          var rev = d && d.revision && d.revision.data;
          if(!rev) return;
          add(rev.portrait_url);
          (rev.works || []).forEach(function(w){ add(w.image_url); });
        }, function(err){ console.warn("[Arch] 讀不到「" + (a.name || a.id) + "」的修改內容，略過裡面的圖", err); });
      });
    }, Promise.resolve()).then(function(){ return urls; });
  }

  /* 每個資料夾裡已經有的檔名：{ 資料夾: { 檔名: true } }；讀不到的資料夾是 null（直接試著上傳，已存在會算跳過） */
  function existingNames(paths){
    var folders = [];
    paths.forEach(function(p){
      var f = p.slice(0, p.lastIndexOf("/"));
      if(folders.indexOf(f) < 0) folders.push(f);
    });
    var map = {};
    return folders.reduce(function(pr, f){
      return pr.then(function(){
        return ArchDB.listImages(f).then(function(names){
          var set = {};
          names.forEach(function(n){ set[n] = true; });
          map[f] = set;
        }, function(err){ console.warn("[Arch] " + err.message, err.cause); map[f] = null; });
      });
    }, Promise.resolve()).then(function(){ return map; });
  }

  /* 一張：回傳 "ok"（新做好）或 "skip"（已經有了）；失敗丟出錯誤 */
  function makeThumb(it, have){
    var tPath = ArchImg.thumbPath(it.path);
    var slash = tPath.lastIndexOf("/");
    var set = have[tPath.slice(0, slash)];
    if(set && set[tPath.slice(slash + 1)]) return Promise.resolve("skip");
    return fetch(it.url).then(function(res){
      if(!res.ok) throw new Error("原圖下載失敗（" + res.status + "）");
      return res.blob();
    }, function(){
      throw new Error("原圖下載失敗，請檢查網路");
    }).then(function(blob){
      return ArchImg.load(blob).catch(function(){ throw new Error("原圖讀不出來（可能不是圖片檔）"); });
    }).then(function(img){
      return ArchImg.toJpeg(img, THUMB_SIDE, THUMB_QUALITY);
    }).then(function(r){
      return ArchDB.uploadThumb(tPath, r.blob);
    }).then(function(s){ return s === "exists" ? "skip" : "ok"; });
  }

  function runThumbs(){
    if(!artists.length){ say(thumbMsg, "畫家資料還沒讀好，請稍等一下再按。", true); return; }
    thumbBtn.disabled = true;
    thumbOut.textContent = "";
    window.addEventListener("beforeunload", warnLeave);
    say(thumbMsg, "正在整理要處理的圖片…完成前請不要關閉這個頁面。");

    var c = { ok: 0, skip: 0, fail: 0 }, fails = [], denied = false, outside = 0, total = 0, done = 0;
    function progress(){
      say(thumbMsg, "處理中：第 " + done + " 張／共 " + total + " 張（新做好 " + c.ok + "、已經有了 " + c.skip + "、失敗 " + c.fail + "）。完成前請不要關閉這個頁面。");
    }

    collectImageUrls().then(function(urls){
      var items = [];
      urls.forEach(function(u){
        var p = ArchImg.storagePath(u);
        if(p) items.push({ url: u, path: p });
        else outside++;                                   // 不在 arch-images（例如還在 demo）的圖不處理
      });
      total = items.length;
      return existingNames(items.map(function(it){ return it.path; })).then(function(have){
        progress();
        var next = 0;
        function worker(){
          if(next >= items.length) return Promise.resolve();
          var it = items[next++];
          return makeThumb(it, have).then(function(s){ c[s]++; }, function(err){
            c.fail++;
            if(err && err.code === "denied") denied = true;
            fails.push({ path: it.path, msg: denied && err.code === "denied" ? "沒有權限上傳（需要先執行 sql/04_thumbs.sql）" : ((err && err.message) || "不明原因") });
            console.warn("[Arch] 縮圖失敗：" + it.path, err);
          }).then(function(){ done++; progress(); return worker(); });
        }
        var workers = [];
        for(var k = 0; k < THUMB_PARALLEL; k++) workers.push(worker());
        return Promise.all(workers);
      });
    }).then(function(){
      var text = "完成：共 " + total + " 張，新做好 " + c.ok + " 張、已經有了 " + c.skip + " 張、失敗 " + c.fail + " 張。";
      if(outside) text += "另外有 " + outside + " 張不在 Arch 的圖庫，沒有處理。";
      say(thumbMsg, text, c.fail > 0);
      var nodes = [];
      if(denied) nodes.push(el("p", { class: "notice notice--warn", text: "有圖片因為權限被擋下：請先在 Supabase 執行 sql/04_thumbs.sql，再回來按一次。" }));
      if(fails.length){
        nodes.push(el("p", { class: "small", text: "失敗的圖片（可以再按一次重試）：" }));
        nodes.push(el("ul", { class: "small thumbs-fails" }, fails.map(function(f){
          return el("li", {}, [el("code", { text: f.path }), "：" + f.msg]);
        })));
      }
      C.fill(thumbOut, nodes);
    }, function(err){
      say(thumbMsg, "沒有完成：" + ((err && err.message) || "請重新整理後再試一次。"), true);
    }).then(function(){
      window.removeEventListener("beforeunload", warnLeave);
      thumbBtn.disabled = false;
      thumbBtn.textContent = "再檢查一次（只補還沒有的）";
    });
  }
  if(thumbBtn) thumbBtn.addEventListener("click", runThumbs);

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
