/* ============================================================
   artist.js — 畫家頁（artist.html?slug=…）
   讀取一位已上架畫家＋作品；沒給 slug、slug 不對、沒有上架 → 「找不到這位畫家」
   版面照 demo（arch-site 畫家個別頁）：左欄畫家資料＋Email／IG，右欄作品卡（整張可點，進 work.html?id=）
   作品卡只在這頁用，寫在這裡，不動 cards.js 的共用卡片（首頁、找畫家不受影響）
   詢問、收藏功能階段 3 接上（詢問對話框還留在 artist.html）
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards;
  if(!C || !window.ArchDB) return;
  var el = C.el;

  function slot(name){ return document.querySelector('[data-slot="' + name + '"]'); }
  function setText(name, text){
    var n = slot(name);
    if(!n) return;
    n.textContent = text || "";
    n.hidden = !text;
  }

  /* ---------- 作品卡（demo 的 .work：圖＋〈標題〉＋媒材／尺寸／價格） ---------- */
  function metaRow(label, value){
    return el("div", {}, [el("dt", { text: label }), el("dd", { text: value })]);
  }

  function workArt(w){
    var box = el("div", { class: "aw-art", attrs: { "aria-hidden": "true" } });
    if(w.image_url){
      var img = el("img", { attrs: { alt: "", loading: "lazy", decoding: "async" } });
      img.onerror = function(){ img.remove(); box.classList.add("is-empty"); };   // 圖片壞掉時改成淺灰底
      C.thumb(img, w.image_url);                  // 縮圖（js/images.js），沒有就自動改用原圖
      box.appendChild(img);
    }else{
      box.classList.add("is-empty");
    }
    return box;
  }

  function workCard(w){
    var t = C.workTitle(w);
    var rows = [
      C.mediumText(w, false) ? metaRow("媒材", C.mediumText(w, false)) : null,
      C.sizeText(w) ? metaRow("尺寸", C.sizeText(w)) : null,
      metaRow("價格", C.priceText(w))
    ];
    var sold = w.status === "sold";
    return el("a", { class: "aw-card", href: C.workHref(w) }, [
      el("div", { class: "aw-frame" }, [
        workArt(w),
        sold ? el("span", { class: "status", text: "已售出" }) : null
      ]),
      el("div", { class: "aw-plate" }, [
        el("h3", { class: "aw-title", text: "〈" + t + "〉" }),
        el("dl", { class: "aw-meta" }, rows)
      ])
    ]);
  }

  /* ---------- 聯絡：Email（黑底）、Instagram（有 Email 時白底框線） ---------- */
  function contactLinks(a){
    var links = [];
    if(a.email){
      var subject = "[Arch] 想詢問" + a.name + "的作品";
      links.push(el("a", { class: "btn", svg: "mail", href: "mailto:" + a.email + "?subject=" + encodeURIComponent(subject),
        attrs: { "aria-label": "寫 Email 給" + a.name + "（會開啟你的郵件程式）" } }, ["Email"]));
    }
    if(a.instagram){
      links.push(el("a", { class: a.email ? "btn btn--ghost" : "btn", svg: "ig",
        href: "https://www.instagram.com/" + encodeURIComponent(a.instagram) + "/",
        attrs: { rel: "noopener noreferrer", target: "_blank", "aria-label": "到 Instagram 看 @" + a.instagram + "（另開視窗）" } }, ["Instagram"]));
    }
    return links;
  }

  /* ---------- 創作故事：900px 以下太長時先收合，按鈕展開 ---------- */
  var storyMq = window.matchMedia("(max-width: 899px)");
  function setupStory(){
    var story = slot("story"), btn = slot("story-toggle");
    if(!story || !btn || story.hidden) return;
    function measure(){
      if(btn.getAttribute("aria-expanded") === "true") return;
      story.classList.add("is-clamped");
      btn.hidden = !(storyMq.matches && story.scrollHeight > story.clientHeight + 2);
      if(btn.hidden) story.classList.remove("is-clamped");
    }
    btn.addEventListener("click", function(){
      var open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "收合故事" : "展開完整故事";
      story.classList.toggle("is-clamped", !open);
    });
    measure();
    if(storyMq.addEventListener) storyMq.addEventListener("change", measure);
    window.addEventListener("resize", measure);
  }

  function render(a){
    document.title = a.name + "｜Arch";
    var desc = document.querySelector('meta[name="description"]');
    if(desc) desc.setAttribute("content", "畫家" + a.name + "的創作故事與作品" + (a.tagline ? "：" + a.tagline : "。"));

    setText("crumb", a.name);
    setText("name", a.name);
    setText("location", a.location);
    slot("location-box").hidden = !a.location;
    setText("tagline", a.tagline);
    setText("inq-name", a.name);
    C.fillAvatar(slot("avatar"), a);

    var tags = slot("tags");
    C.fill(tags, C.tagList(a.tags));
    tags.hidden = !tags.firstChild;

    slot("custom-badge").hidden = !a.custom_ok;
    setText("custom-note", a.custom_ok ? (a.custom_note || "").trim() : "");

    /* 公開聯絡方式（畫家自己填的公開資料）；都沒有就整段不顯示 */
    var links = contactLinks(a);
    C.fill(slot("links"), links);
    setText("contact-label", "對這幅作品有興趣？直接聯絡" + a.name + "。");
    slot("contact").hidden = !links.length;

    /* 創作故事（保留換行） */
    var story = (a.story || "").trim();
    setText("story", story);
    slot("story-box").hidden = !story;

    /* 作品 */
    var works = a.works || [];
    setText("work-count", works.length ? "（共 " + works.length + " 件）" : "");
    var grid = slot("works");
    if(works.length){
      C.fill(grid, works.map(workCard));
    }else{
      grid.classList.remove("aw-grid");
      C.fill(grid, C.emptyBox("這位畫家還沒有放上作品。"));
    }
  }

  var reload = document.querySelector('[data-action="reload"]');
  if(reload) reload.addEventListener("click", function(){ location.reload(); });

  var slug = new URLSearchParams(location.search).get("slug");
  window.ArchDB.getArtist(slug).then(function(a){
    if(!a){
      document.title = "找不到這位畫家｜Arch";
      C.showState("missing");
      return;
    }
    render(a);
    C.showState("ready");
    setupStory();   // 顯示後才量得到高度
  }).catch(function(err){
    setText("error-msg", (err && err.message) || "請檢查網路後再試一次。");
    C.showState("error");
  });
})();
