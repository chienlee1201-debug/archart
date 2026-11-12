/* ============================================================
   cards.js — 公開頁面共用的「畫出來」工具（純介面，不碰資料庫）
   資料由 db.js 讀進來後，交給這裡變成畫面。首頁、找畫家、畫家頁、作品頁共用。

   · 所有畫家／作品文字一律用 textContent 放進去，不用 innerHTML 拼接（避免奇怪字元弄壞畫面）
   · 媒材顯示規則（PLAN 2.2 works.support）：
       「媒材・底材」；列表卡片底材是「麻紙／絹」時省略；作品詳細頁一律完整；沒有底材只顯示媒材
   · ArchAvatar：畫家頭像規則 portrait_url → 第一件作品圖 → 名字首字
       <span class="avatar" data-avatar data-portrait="…" data-first-work="…" data-initial="林">
       ArchAvatar.apply(root) 套用 root 底下全部；ArchAvatar.one(el) 只套一個
   · 卡片、頭像的圖片都用縮圖（js/images.js，要在這份之前載入）；thumb(img, url) 也開放給各頁用（ArchCards.thumb）
   · ArchWish：許願牆的願望卡片、提案、預算／場合／日期格式（檔案最後面）
   ============================================================ */
(function(){
  "use strict";

  /* ---------- 固定圖示（程式內建的 SVG，不含使用者內容） ---------- */
  var SVG = {
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    ig:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/></svg>',
    mail:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>'
  };

  var STATUS = { available: "可購買", sold: "已售出", not_for_sale: "非賣品" };

  /* ---------- 建立元素 ----------
     el("a", { class:"x", href:"…", text:"文字", attrs:{ "aria-label":"…" } }, [子元素…]) */
  function el(tag, opt, kids){
    var n = document.createElement(tag);
    opt = opt || {};
    if(opt.class) n.className = opt.class;
    if(opt.text != null) n.textContent = opt.text;
    if(opt.href) n.setAttribute("href", opt.href);
    if(opt.svg) n.insertAdjacentHTML("afterbegin", SVG[opt.svg]);
    if(opt.attrs) Object.keys(opt.attrs).forEach(function(k){
      if(opt.attrs[k] != null) n.setAttribute(k, opt.attrs[k]);
    });
    (kids || []).forEach(function(k){
      if(k == null || k === false) return;
      n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    });
    return n;
  }

  /* ---------- 文字格式 ---------- */
  function num(n){ return Number(n).toLocaleString("en-US"); }
  function cm(n){ return String(Math.round(Number(n) * 10) / 10); }

  function workTitle(w){ return (w && w.title && String(w.title).trim()) || "未命名作品"; }

  /* 媒材：full = true 用在作品詳細頁（一律完整） */
  function mediumText(w, full){
    var m = w.medium || "", s = w.support || "";
    if(s && !full && s === "麻紙／絹") s = "";
    if(m && s) return m + "・" + s;
    return m || s;
  }

  function sizeText(w){
    if(!(w.width_cm > 0 && w.height_cm > 0)) return "";
    return cm(w.width_cm) + " × " + cm(w.height_cm) + " cm";
  }

  /* 價格：有 price_max 顯示區間，沒有就單一價格；非賣品直接寫非賣品 */
  function priceText(w){
    if(w.status === "not_for_sale") return "非賣品";
    if(!(w.price_min > 0)) return "價格請洽畫家";
    var s = "NT$ " + num(w.price_min);
    if(w.price_max > w.price_min) s += "–" + num(w.price_max);
    return s;
  }

  function statusText(w){ return STATUS[w.status] || ""; }

  function initialOf(name){
    var s = String(name || "").trim();
    return s ? Array.from(s)[0].toUpperCase() : "";
  }

  function artistHref(a){ return "artist.html?slug=" + encodeURIComponent(a.slug); }
  function workHref(w){ return "work.html?id=" + encodeURIComponent(w.id); }

  /* ---------- 圖片：卡片、頭像一律用縮圖（js/images.js；縮圖載入失敗自動退回原圖，原圖也失敗才走 onerror） ---------- */
  function thumb(img, url){
    if(window.ArchImg) window.ArchImg.useThumb(img, url);
    else img.src = url;
  }

  /* ---------- 頭像 ---------- */
  function applyAvatar(n){
    var portrait = (n.getAttribute("data-portrait") || "").trim();
    var firstWork = (n.getAttribute("data-first-work") || "").trim();
    var initial = n.getAttribute("data-initial") || "";
    var isPh = /^ph--\d+$/.test(firstWork);               // 示範資料：用作品色塊佔位
    var tries = [portrait, isPh ? "" : firstWork].filter(Boolean);
    n.textContent = "";
    function next(){
      var src = tries.shift();
      if(!src){ n.textContent = initial; return; }
      var img = document.createElement("img");
      img.alt = ""; img.loading = "lazy"; img.decoding = "async";
      img.onerror = function(){ img.remove(); next(); };    // 圖片壞掉時換下一個，最後退回首字
      thumb(img, src);
      n.appendChild(img);
    }
    if(tries.length) next();
    else if(isPh) n.appendChild(el("span", { class: "ph " + firstWork }));
    else n.textContent = initial;
  }
  function applyAll(root){
    Array.prototype.forEach.call((root || document).querySelectorAll("[data-avatar]"), applyAvatar);
  }

  /* 依畫家資料做一個頭像。cls 例如 "avatar avatar--sm" */
  function avatar(a, cls){
    var first = a.works && a.works[0];
    var n = el("span", { class: cls || "avatar", attrs: {
      "data-avatar": "", "aria-hidden": "true",
      "data-portrait": a.portrait_url || "",
      "data-first-work": (first && first.image_url) || "",
      "data-initial": initialOf(a.name)
    }});
    applyAvatar(n);
    return n;
  }
  /* 把現成的頭像位置（data-avatar）換成這位畫家 */
  function fillAvatar(n, a){
    var first = a.works && a.works[0];
    n.setAttribute("data-portrait", a.portrait_url || "");
    n.setAttribute("data-first-work", (first && first.image_url) || "");
    n.setAttribute("data-initial", initialOf(a.name));
    applyAvatar(n);
  }

  /* ---------- 作品圖（卡片用：固定 4:5 框、裁切填滿，圖片載入前後版面不跳） ---------- */
  var phSeq = 0;
  function workArt(w, label){
    var box = el("div", { class: "ph ph--" + (phSeq++ % 6 + 1), attrs: { role: "img", "aria-label": label } });
    if(w && w.image_url){
      var img = el("img", { attrs: { alt: "", loading: "lazy", decoding: "async" } });
      img.onerror = function(){ img.remove(); };            // 圖片壞掉時留下色塊
      thumb(img, w.image_url);
      box.appendChild(img);
    }
    return box;
  }

  /* ---------- 卡片 ---------- */
  function favBtn(label){
    return el("button", { class: "fav-btn", svg: "heart", attrs: { type: "button", "aria-pressed": "false", "aria-label": label } });
  }

  function customBadge(){
    return el("span", { class: "badge", svg: "check" }, ["接受客製委託"]);
  }

  function tagList(tags, max, ariaLabel){
    tags = (tags || []).filter(function(t){ return t && String(t).trim(); });
    if(max) tags = tags.slice(0, max);
    if(!tags.length) return null;
    return el("ul", { class: "tags", attrs: { "aria-label": ariaLabel || null } },
      tags.map(function(t){ return el("li", { class: "tag", text: t }); }));
  }

  /* 作品卡片。opt.showArtist：在說明前面加畫家名字（找畫家、首頁）；畫家頁自己就不用 */
  function workCard(w, opt){
    opt = opt || {};
    var t = workTitle(w);
    var meta = [opt.showArtist && w.artist ? w.artist.name : "", mediumText(w, false), sizeText(w)]
      .filter(Boolean).join("・");
    return el("article", { class: "card work-card" }, [
      el("a", { class: "card-link", href: workHref(w) }, [
        workArt(w, "作品〈" + t + "〉"),
        el("div", { class: "card-body" }, [
          el("h3", { class: "card-title", text: t }),
          meta ? el("p", { class: "work-meta", text: meta }) : null,
          el("p", { class: "price", text: priceText(w) })
        ])
      ]),
      w.status === "sold" ? el("span", { class: "status", text: "已售出" }) : null,
      favBtn("收藏〈" + t + "〉")
    ]);
  }

  /* 畫家卡片（找畫家）：封面是第一件作品 */
  function artistCard(a){
    var first = a.works && a.works[0];
    return el("article", { class: "card artist-card" }, [
      el("a", { class: "card-link", href: artistHref(a) }, [
        workArt(first, a.name + "的代表作品"),
        el("div", { class: "card-body" }, [
          el("div", { class: "who" }, [
            avatar(a, "avatar"),
            el("div", {}, [
              el("h3", { class: "card-title", text: a.name }),
              a.tagline ? el("p", { class: "card-sub", text: a.tagline }) : null
            ])
          ]),
          tagList(a.tags, 4),
          a.custom_ok ? customBadge() : null
        ])
      ]),
      favBtn("收藏 " + a.name)
    ]);
  }

  /* ---------- 狀態：沒有資料／讀取失敗 ---------- */
  function emptyBox(msg, action){
    return el("div", { class: "empty" }, [el("p", { text: msg }), action || null]);
  }
  function errorBox(err){
    var btn = el("button", { class: "btn btn--ghost btn--sm", text: "重新整理", attrs: { type: "button" } });
    btn.addEventListener("click", function(){ location.reload(); });
    var msg = (err && err.message) || "暫時讀不到資料，請稍後再試一次。";
    return el("div", { class: "empty empty--bad", attrs: { role: "alert" } }, [
      el("p", { text: "資料沒有順利載入：" + msg }), btn
    ]);
  }
  function fill(container, nodes){
    container.textContent = "";
    container.removeAttribute("aria-busy");
    (Array.isArray(nodes) ? nodes : [nodes]).forEach(function(n){ if(n) container.appendChild(n); });
  }

  /* 整頁的狀態切換：<… data-state="loading|ready|missing|error"> 只顯示其中一個 */
  function showState(name){
    Array.prototype.forEach.call(document.querySelectorAll("[data-state]"), function(n){
      n.hidden = n.getAttribute("data-state") !== name;
    });
  }

  function shuffle(a){
    a = a.slice();
    for(var i = a.length - 1; i > 0; i--){ var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ============================================================
     許願牆（ArchWish）：願望、提案的文字格式與卡片。選項要和 sql/06_wishes.sql 一致
     · 許願牆列表卡片只有文字、不放任何圖片
     · 提案的畫家頭像：portrait_url（縮圖）→ 名字首字（不用作品圖）
     ============================================================ */
  /* 預算區間代碼 → 顯示文字（許願對話框的選項在 wishes.html，代碼要和 sql/07_budget_ranges.sql 一致）
     "0-5000" 是 2026-11-12 拆成 0-2500／2500-5000 之前的舊代碼：新許願不能再選，舊願望照樣顯示 */
  var BUDGET = {
    "0-2500": "NT$ 2,500 以下", "2500-5000": "NT$ 2,500–5,000",
    "5000-10000": "NT$ 5,000–10,000", "10000-20000": "NT$ 10,000–20,000",
    "20000-50000": "NT$ 20,000–50,000", "50000-": "NT$ 50,000 以上",
    "0-5000": "NT$ 5,000 以下"
  };
  /* 願望狀態：[文字, status 樣式] */
  var WISH_STATUS = {
    pending: ["待審核", "warn"], open: ["徵求提案中", "ok"], closed: ["已結束", ""], rejected: ["未通過", "bad"]
  };
  SVG.arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function budgetText(code){ return BUDGET[code] || ""; }
  function occasionText(w){
    if(w.occasion === "其他") return (w.occasion_other && String(w.occasion_other).trim()) || "其他";
    return w.occasion || "";
  }
  /* 標題：有填用標題，沒填取內容開頭 16 個字 */
  function wishTitle(w){
    var t = w && w.title && String(w.title).trim();
    if(t) return t;
    var s = Array.from(String((w && w.story) || "").replace(/\s+/g, " ").trim());
    return s.length > 16 ? s.slice(0, 16).join("") + "…" : (s.join("") || "未命名的願望");
  }
  function wishHref(w){ return "wish.html?id=" + encodeURIComponent(w.id); }
  function authorText(w){ return w.author_name || "匿名收藏家"; }
  function wishStatusBadge(st){
    var s = WISH_STATUS[st] || [st, ""];
    return el("span", { class: "status" + (s[1] ? " status--" + s[1] : ""), text: s[0] });
  }

  /* 日期 2026/11/11；ago：一週內寫「3 天前」 */
  function dateText(s){
    var d = new Date(s);
    return isNaN(d) ? "" : d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
  }
  function agoText(s){
    var d = new Date(s), diff = (Date.now() - d.getTime()) / 1000;
    if(isNaN(diff)) return "";
    if(diff < 60) return "剛剛";
    if(diff < 3600) return Math.floor(diff / 60) + " 分鐘前";
    if(diff < 86400) return Math.floor(diff / 3600) + " 小時前";
    if(diff < 7 * 86400) return Math.floor(diff / 86400) + " 天前";
    return dateText(s);
  }
  function timeEl(s, cls){
    return el("time", { class: cls || "muted small", text: agoText(s), attrs: { datetime: s, title: dateText(s) } });
  }

  /* 場合／預算／尺寸（＋許願日期） */
  function wishFacts(w, withDate){
    var rows = [["場合", occasionText(w)], ["預算", budgetText(w.budget_range)], ["尺寸", w.size]];
    if(withDate) rows.push(["許願日期", dateText(w.created_at)]);
    return el("dl", { class: "wish-facts" }, rows.filter(function(r){ return r[1]; }).map(function(r){
      return el("div", {}, [el("dt", { text: r[0] }), el("dd", { text: r[1] })]);
    }));
  }

  /* 許願牆卡片（只有文字） */
  function wishCard(w){
    var n = w.proposal_count || 0;
    var title = w.title && String(w.title).trim();
    return el("article", { class: "wish-card" }, [
      tagList(w.tags, 0, "題材"),
      title ? el("h3", { class: "wish-card-title", text: title }) : null,
      el("blockquote", { class: "wish-quote wish-quote--clamp", text: "「" + String(w.story || "").trim() + "」" }),
      wishFacts(w),
      el("div", { class: "wish-foot" }, [
        el("span", { text: "— " + authorText(w) }),
        moreLink(wishHref(w), n ? n + " 則畫家提案" : "還沒有提案",
          "看願望「" + wishTitle(w) + "」" + (n ? "的 " + n + " 則畫家提案" : "（還沒有提案）"))
      ])
    ]);
  }
  /* 文字＋右箭頭的連結 */
  function moreLink(href, text, label){
    var a = el("a", { class: "more-link", href: href, text: text, attrs: { "aria-label": label || null } });
    a.insertAdjacentHTML("beforeend", " " + SVG.arrow);
    return a;
  }

  /* 一則提案（像留言）：頭像＋名字（都連到畫家頁）＋時間＋提案內容 */
  function proposalItem(p){
    var href = "artist.html?slug=" + encodeURIComponent(p.artist_slug || "");
    return el("article", { class: "proposal", attrs: { "data-id": p.id } }, [
      el("div", { class: "proposal-head" }, [
        el("a", { class: "proposal-artist", href: href }, [
          avatar({ name: p.artist_name, portrait_url: p.artist_portrait, works: [] }, "avatar avatar--sm"),
          el("span", { text: p.artist_name || "畫家" })
        ]),
        timeEl(p.created_at)
      ]),
      el("p", { class: "proposal-msg", text: p.message || "" })
    ]);
  }

  window.ArchWish = {
    budgetText: budgetText, occasionText: occasionText, wishTitle: wishTitle, wishHref: wishHref, authorText: authorText,
    statusBadge: wishStatusBadge, statusText: function(st){ return (WISH_STATUS[st] || [st])[0]; },
    dateText: dateText, agoText: agoText, timeEl: timeEl,
    wishFacts: wishFacts, wishCard: wishCard, moreLink: moreLink,
    proposalItem: proposalItem
  };

  window.ArchAvatar = { apply: applyAll, one: applyAvatar };
  window.ArchCards = {
    el: el, svg: SVG,
    workTitle: workTitle, mediumText: mediumText, sizeText: sizeText, priceText: priceText, statusText: statusText,
    initialOf: initialOf, artistHref: artistHref, workHref: workHref,
    avatar: avatar, fillAvatar: fillAvatar, workArt: workArt, thumb: thumb, tagList: tagList, customBadge: customBadge,
    workCard: workCard, artistCard: artistCard,
    emptyBox: emptyBox, errorBox: errorBox, fill: fill, showState: showState, shuffle: shuffle
  };

  applyAll();   // 頁面上現成的 data-avatar（例如示範資料）
})();
