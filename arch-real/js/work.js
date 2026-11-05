/* ============================================================
   work.js — 作品頁（work.html?id=…）
   讀取一件作品＋所屬畫家（只限已上架畫家）；沒給 id、id 不對、已下架 → 「找不到這件作品」
   媒材在這一頁一律完整顯示（例如「膠彩・麻紙／絹」）
   詢問、收藏按鈕維持原樣（階段 3 接上）
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards;
  if(!C || !window.ArchDB) return;

  function slot(name){ return document.querySelector('[data-slot="' + name + '"]'); }
  function setText(name, text){
    var n = slot(name);
    if(!n) return;
    n.textContent = text || "";
    n.hidden = !text;
  }

  /* 大圖：框的比例照作品真實寬高，圖片載入前版面就先佔好位置 */
  function figure(w, title){
    var fig = slot("figure");
    fig.textContent = "";
    if(w.width_cm > 0 && w.height_cm > 0) fig.style.setProperty("--ratio", w.width_cm + " / " + w.height_cm);
    if(w.image_url){
      var img = C.el("img", { attrs: { alt: "作品〈" + title + "〉，" + w.artist.name + "的作品", decoding: "async" } });
      img.onerror = function(){
        img.remove();
        fig.classList.add("is-broken");
        fig.appendChild(C.el("div", { class: "ph", attrs: { role: "img", "aria-label": "作品〈" + title + "〉（圖片暫時無法顯示）" } }));
      };
      img.src = w.image_url;
      fig.appendChild(img);
    }else{
      fig.appendChild(C.el("div", { class: "ph", attrs: { role: "img", "aria-label": "作品〈" + title + "〉（還沒有圖片）" } }));
    }
  }

  function specRow(label, value){
    if(!value) return null;
    return C.el("div", {}, [C.el("dt", { text: label }), C.el("dd", { text: value })]);
  }

  function render(w){
    var a = w.artist, t = C.workTitle(w);
    document.title = t + "・" + a.name + "｜Arch";
    var desc = document.querySelector('meta[name="description"]');
    if(desc) desc.setAttribute("content", [a.name + "的作品〈" + t + "〉", C.mediumText(w, true), C.sizeText(w)].filter(Boolean).join("，") + "。");

    var crumbArtist = slot("crumb-artist");
    crumbArtist.textContent = a.name;
    crumbArtist.setAttribute("href", C.artistHref(a));
    setText("crumb", t);

    figure(w, t);

    var st = slot("status");
    st.textContent = C.statusText(w) || "可購買";
    st.className = "status" + (w.status === "available" ? " status--ok" : "");

    setText("title", t);
    slot("by").setAttribute("href", C.artistHref(a));
    setText("by-name", a.name);
    C.fillAvatar(slot("by-avatar"), a);

    setText("price", C.priceText(w));

    var specs = slot("specs");
    C.fill(specs, [
      specRow("媒材", C.mediumText(w, true)),
      specRow("尺寸", C.sizeText(w)),
      specRow("年份", w.year ? String(w.year) : ""),
      specRow("客製委託", a.custom_ok ? "接受" : "目前不接受")
    ]);

    setText("desc", (w.description || "").trim());

    slot("fav").setAttribute("aria-label", "收藏〈" + t + "〉");
    setText("inq-name", a.name);
    setText("inq-about", "關於作品〈" + t + "〉");

    /* 同一位畫家的其他作品；沒有就整段不顯示 */
    var others = (a.works || []).filter(function(x){ return x.id !== w.id; });
    slot("more-title").textContent = a.name + "的其他作品";
    slot("more-link").setAttribute("href", C.artistHref(a));
    C.fill(slot("more"), others.map(function(x){ return C.workCard(x); }));
    slot("more-section").hidden = !others.length;
  }

  var reload = document.querySelector('[data-action="reload"]');
  if(reload) reload.addEventListener("click", function(){ location.reload(); });

  var id = new URLSearchParams(location.search).get("id");
  window.ArchDB.getWork(id).then(function(w){
    if(!w){
      document.title = "找不到這件作品｜Arch";
      C.showState("missing");
      return;
    }
    render(w);
    C.showState("ready");
  }).catch(function(err){
    setText("error-msg", (err && err.message) || "請檢查網路後再試一次。");
    C.showState("error");
  });
})();
