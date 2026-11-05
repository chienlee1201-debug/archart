/* ============================================================
   cards.js — 公開頁面共用的「畫出來」工具（純介面，不碰資料庫）
   資料由 db.js 讀進來後，交給這裡變成畫面。首頁、找畫家、畫家頁、作品頁共用。

   · 所有畫家／作品文字一律用 textContent 放進去，不用 innerHTML 拼接（避免奇怪字元弄壞畫面）
   · 媒材顯示規則（PLAN 2.2 works.support）：
       「媒材・底材」；列表卡片底材是「麻紙／絹」時省略；作品詳細頁一律完整；沒有底材只顯示媒材
   · ArchAvatar：畫家頭像規則 portrait_url → 第一件作品圖 → 名字首字
       <span class="avatar" data-avatar data-portrait="…" data-first-work="…" data-initial="林">
       ArchAvatar.apply(root) 套用 root 底下全部；ArchAvatar.one(el) 只套一個
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
      img.src = src;
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
      img.src = w.image_url;
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

  window.ArchAvatar = { apply: applyAll, one: applyAvatar };
  window.ArchCards = {
    el: el, svg: SVG,
    workTitle: workTitle, mediumText: mediumText, sizeText: sizeText, priceText: priceText, statusText: statusText,
    initialOf: initialOf, artistHref: artistHref, workHref: workHref,
    avatar: avatar, fillAvatar: fillAvatar, workArt: workArt, tagList: tagList, customBadge: customBadge,
    workCard: workCard, artistCard: artistCard,
    emptyBox: emptyBox, errorBox: errorBox, fill: fill, showState: showState, shuffle: shuffle
  };

  applyAll();   // 頁面上現成的 data-avatar（例如示範資料）
})();
