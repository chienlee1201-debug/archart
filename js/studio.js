/* ============================================================
   studio.js — 畫家後台（studio.html）
   需要先載入：config.js、images.js、supabase-js、db.js、auth.js、ui.js、cards.js

   · 需要登入。還沒有畫家頁 → 導向 apply.html
   · 管理者用 studio.html?artist=<畫家 id> 編輯任何畫家：頂部顯示「你正在以管理者身分編輯 ○○○」，儲存直接生效
   · 整份（畫家資料＋作品清單）一起存：ArchDB.saveArtist → arch_save_artist（sql/02_artists.sql）
       還沒上架：直接存；「送出審核」後變成待審核
       已上架：存成「待審核的修改」，網站維持舊版；有修改時編輯的是那份修改
   · 圖片（頭像、作品）選了就先上傳到 Storage（arch-images/畫家 id/…），按儲存才會真的換上
     長邊超過 1600px 或檔案超過約 1MB 的圖，先在瀏覽器縮成長邊 1600px 的 JPG（品質 0.85）；
     同時做一張長邊 800px 的縮圖（JPG 0.8），存在同一個資料夾、檔名＋「-s.jpg」（js/images.js）；
     記下大圖像素寬高（works.image_w／image_h）
   · 收到的詢問：準備中（階段 3）；許願提案由 js/studio-proposals.js 處理（sql/06_wishes.sql）
   · 畫家頁網址（slug）：畫家看不到也不用填，送出審核時由資料庫自動產生（sql/05_slug_location.sql）；
     只有管理者模式顯示網址欄、送出 slug。畫家送來的 slug 資料庫也不會採用，已上架畫家的網址不會變
   · 我的位置（location）：選填下拉選單，選項和 sql/05 的 _arch_locations() 一致
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards;
  if(!C || !window.ArchDB || !window.ArchAuth) return;
  var el = C.el;

  var MEDIUMS = ["油畫","壓克力","水彩","膠彩","水墨","色鉛筆","粉彩","素描","版畫","複合媒材","電繪","其他"];
  var SUPPORTS = ["畫布","紙","木板","麻紙／絹","其他"];
  var WORK_STATUS = [["available","可購買"],["sold","已售出"],["not_for_sale","非賣品"]];
  var ARTIST_STATUS = { draft: "草稿", pending: "待審核", approved: "已上架", needs_changes: "需修改" };
  var MAX_WORKS = 9;
  var MAX_BYTES = 5 * 1024 * 1024;   // Storage 上限（sql/02_artists.sql）
  var KEEP_BYTES = 1024 * 1024;       // 原檔超過約 1MB 就重新壓縮
  var MAX_SIDE = 1600, JPG_QUALITY = 0.85;       // 大圖：長邊 1600px
  var THUMB_SIDE = 800, THUMB_QUALITY = 0.8;     // 縮圖：長邊 800px（列表、卡片、頭像用）
  var EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  /* 固定圖示（程式內建，不含使用者內容） */
  var ICON = {
    up:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    remove:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    person:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    info:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>'
  };

  var form = document.getElementById("studio-form");
  var params = new URLSearchParams(location.search);
  function slot(n){ return document.querySelector('[data-slot="' + n + '"]'); }
  function byId(id){ return document.getElementById(id); }
  function str(v){ return v == null ? "" : String(v); }

  var state = {
    data: null,          // 最近一次從資料庫讀到的整份資料
    mode: "direct",      // admin／revision／direct
    artistId: null,
    portrait: null,      // 頭像網址
    works: [],           // 編輯中的作品（欄位都是字串，送出時由資料庫檢查）
    uploads: 0,          // 正在上傳的圖片數
    dirty: false,
    busy: false,
    submitMeans: true    // 主要按鈕是「送出審核」（true）還是「儲存」（false）
  };
  var keySeq = 0;

  /* ============================================================
     圖片：讀出寬高；大圖縮成長邊 1600px 的 JPG，另外做一張長邊 800px 的縮圖
     回傳 { blob, w, h, ext, thumb }（縮圖做不出來時 thumb = null，不擋上傳）
     ============================================================ */
  function prepareImage(file){
    if(!file) return Promise.reject(new Error("沒有選到圖片。"));
    if(!EXT[file.type]) return Promise.reject(new Error("只能上傳 JPG、PNG 或 WebP 圖片。"));
    var I = window.ArchImg;
    if(!I) return Promise.reject(new Error("頁面沒有載入完整，請重新整理後再試一次。"));
    return I.load(file).then(function(img){
      var w = img.naturalWidth, h = img.naturalHeight;
      // 不超過 1600px 而且檔案不大（約 1MB 內）才直接用原檔，其他一律重新壓縮（避免大 PNG 原檔照傳）
      var big = Math.max(w, h) > MAX_SIDE || file.size > KEEP_BYTES;
      var main = big
        ? I.toJpeg(img, MAX_SIDE, JPG_QUALITY).then(function(r){
            if(r.blob.size > MAX_BYTES) throw new Error("圖片太大了，請換一張小一點的（5MB 內）。");
            return { blob: r.blob, w: r.w, h: r.h, ext: "jpg" };
          })
        : Promise.resolve({ blob: file, w: w, h: h, ext: EXT[file.type] });
      return main.then(function(r){
        return I.toJpeg(img, THUMB_SIDE, THUMB_QUALITY).then(function(t){ r.thumb = t.blob; return r; }, function(e){
          console.warn("[Arch] 縮圖產生失敗，只上傳大圖", e);
          r.thumb = null;
          return r;
        });
      });
    });
  }

  function upload(file){
    return prepareImage(file).then(function(r){
      return ArchDB.uploadImage(state.artistId, r.blob, r.ext, r.thumb).then(function(url){
        return { url: url, w: r.w, h: r.h };
      });
    });
  }

  /* ============================================================
     儲存狀態、按鈕
     ============================================================ */
  function setStatus(text, kind){
    var n = slot("save-status");
    n.textContent = text || "";
    n.className = "save-status" + (kind ? " is-" + kind : "");
  }

  function markDirty(){
    state.dirty = true;
    if(slot("save-status").classList.contains("is-ok")) setStatus("");
  }

  function updateButtons(){
    var off = state.busy || state.uploads > 0;
    slot("save-btn").disabled = off;
    slot("submit-btn").disabled = off;
  }

  /* 依模式與狀態決定按鈕文字與說明 */
  function configureActions(){
    var a = state.data.artist, r = state.data.revision;
    var saveBtn = slot("save-btn"), submitBtn = slot("submit-btn"), hint = "";
    saveBtn.hidden = false;
    state.submitMeans = true;
    if(state.mode === "admin"){
      saveBtn.hidden = true;
      submitBtn.textContent = "儲存並直接生效";
      state.submitMeans = false;
      hint = "管理者儲存後直接生效，不用審核。";
    }else if(state.mode === "revision"){
      if(r && r.status === "pending"){
        saveBtn.hidden = true;
        submitBtn.textContent = "儲存修改";
        state.submitMeans = false;
        hint = "修改審核中：存檔會更新送審的內容，網站上先維持目前的版本。";
      }else{
        saveBtn.textContent = "先儲存，不送出";
        submitBtn.textContent = "送出審核";
        hint = "送出後會重新審核，審核期間網站上維持目前的版本。";
      }
    }else if(a.status === "pending"){
      saveBtn.hidden = true;
      submitBtn.textContent = "儲存修改";
      state.submitMeans = false;
      hint = "審核中：存檔後我們審核時會看到最新的內容。";
    }else if(a.status === "needs_changes"){
      saveBtn.textContent = "儲存";
      submitBtn.textContent = "重新送出審核";
      hint = "照審核備註改好後，按「重新送出審核」。";
    }else{
      saveBtn.textContent = "儲存草稿";
      submitBtn.textContent = "送出審核";
      hint = "可以先儲存草稿，下次再繼續。";
    }
    slot("save-hint").textContent = hint;
    updateButtons();
  }

  /* ============================================================
     上方：管理者提示列、頭像與名字、狀態提示
     ============================================================ */
  function renderHead(){
    var a = state.data.artist;
    var name = byId("a-name").value.trim();
    var first = state.works.filter(function(w){ return w.image_url; })[0];
    C.fillAvatar(slot("head-avatar"), { name: name, portrait_url: state.portrait, works: first ? [first] : [] });
    slot("head-name").textContent = name || "還沒填名字";
    var link = slot("head-link");
    link.textContent = "";
    if(a.status === "approved" && a.slug){
      link.appendChild(document.createTextNode("・"));
      link.appendChild(el("a", { class: "link", href: C.artistHref(a), text: state.mode === "admin" ? "看公開頁面" : "看我的公開頁面",
        attrs: { target: "_blank", rel: "noopener" } }));
    }else{
      link.appendChild(document.createTextNode("・" + (ARTIST_STATUS[a.status] || "") + "，還沒上架"));
    }

    var bar = slot("admin-bar");
    bar.hidden = state.mode !== "admin";
    if(state.mode === "admin"){
      slot("admin-name").textContent = a.name || "未命名畫家";
      var o = state.data.owner;
      slot("admin-owner").textContent = a.claimed
        ? "（帳號：" + ((o && (o.email || o.display_name)) || "已綁定") + "）"
        : "（還沒有人認領）";
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-slot="admin-only"]'), function(n){ n.hidden = state.mode !== "admin"; });
  }

  function notice(kind, title, body, actions){
    var p = el("p", {}, [el("strong", { text: title })].concat(body || []));
    var n = el("div", { class: "notice" + (kind ? " notice--" + kind : ""), attrs: { role: kind === "bad" ? "alert" : null } }, [p]);
    n.insertAdjacentHTML("afterbegin", ICON.info);
    if(actions && actions.length) p.appendChild(el("span", { class: "notice-actions" }, actions));
    return n;
  }

  function discardButton(label){
    var b = el("button", { class: "btn btn--light btn--sm", text: label, attrs: { type: "button" } });
    b.addEventListener("click", discardRevision);
    return b;
  }

  function noteText(t){ return el("span", { class: "notice-quote", text: t }); }

  function renderNotices(){
    var a = state.data.artist, r = state.data.revision, list = [];
    if(params.get("claimed") === "1" && state.mode !== "admin"){
      list.push(notice("ok", "認領完成！", ["以後用這個 Google 帳號登入，就能在這裡管理你的畫家頁和作品。"]));
    }
    if(state.mode === "admin"){
      list.push(notice("", "目前狀態：" + (ARTIST_STATUS[a.status] || a.status), [
        a.status === "approved" ? "網站上看得到這位畫家。" : "網站上還看不到這位畫家。審核請到管理後台。"
      ]));
      if(r && r.status === "pending"){
        list.push(notice("warn", "這位畫家有一份修改正在等審核", [
          "你在這裡改的是網站上目前的版本。之後在管理後台核准那份修改時，會用畫家送來的版本蓋過去。"]));
      }
      if(a.review_note && a.status === "needs_changes"){
        list.push(notice("bad", "上次退回的審核備註", [noteText(a.review_note)]));
      }
    }else if(a.status === "draft"){
      list.push(notice("", "草稿", ["填好畫家資料和作品後，按最下面的「送出審核」。可以先儲存草稿，下次再繼續。"]));
    }else if(a.status === "pending"){
      list.push(notice("warn", "審核中", ["你的資料已經送出，審核通過後就會出現在網站上。審核期間還是可以修改，存檔後我們會看到最新的內容。"]));
    }else if(a.status === "needs_changes"){
      list.push(notice("bad", "需要修改", a.review_note
        ? ["審核備註：", noteText(a.review_note), "改好後按最下面的「重新送出審核」。"]
        : ["請調整資料或作品後，按最下面的「重新送出審核」。"]));
    }else if(!r){
      list.push(notice("ok", "已上架", ["你的畫家頁已經公開。修改資料或作品後要按「送出審核」，通過前網站上維持目前的版本。"]));
    }else if(r.status === "pending"){
      list.push(notice("warn", "修改審核中", ["網站上先維持目前的版本，審核通過後就會換成新的。你可以繼續修改，存檔後我們會看到最新的內容。"],
        [discardButton("撤回並放棄這次修改")]));
    }else if(r.status === "rejected"){
      list.push(notice("bad", "這次的修改沒有通過", (r.review_note ? ["審核備註：", noteText(r.review_note)] : [])
        .concat(["網站上維持目前的版本。你可以照備註調整後再送出審核，或放棄這次修改。"]), [discardButton("放棄這次修改")]));
    }else{
      list.push(notice("warn", "有還沒送出的修改", ["下面是你修改中的版本，網站上還是目前的版本。改好後按「送出審核」。"],
        [discardButton("放棄修改，回到網站上的版本")]));
    }
    C.fill(slot("notices"), list);
  }

  /* ============================================================
     畫家資料
     ============================================================ */
  function fillProfile(p){
    byId("a-name").value = str(p.name);
    byId("a-slug").value = str(p.slug);
    byId("a-tagline").value = str(p.tagline);
    byId("a-story").value = str(p.story);
    byId("a-tags").value = (p.tags || []).join(", ");
    byId("a-email").value = str(p.email);
    byId("a-ig").value = str(p.instagram);
    byId("a-location").value = str(p.location);
    if(byId("a-location").value !== str(p.location)) byId("a-location").value = "";   // 不在選單裡的值當作沒填
    var ok = form.querySelector('input[name="custom_ok"][value="' + (p.custom_ok ? "true" : "false") + '"]');
    if(ok) ok.checked = true;
    byId("a-custom").value = str(p.custom_note);
    byId("a-sort").value = str(state.data.artist.sort_order);
    state.portrait = p.portrait_url || null;
    renderPortrait();
    updateCounters();
    updateSlugPreview();
  }

  function updateCounters(){
    Array.prototype.forEach.call(document.querySelectorAll("[data-counter]"), function(n){
      var input = byId(n.getAttribute("data-counter"));
      n.textContent = Array.from(input.value).length + " / " + n.getAttribute("data-max");
    });
  }

  function updateSlugPreview(){
    var v = byId("a-slug").value.trim().toLowerCase();
    var n = slot("slug-preview");
    var field = byId("a-slug").closest(".field");
    if(!v){ n.textContent = "空白的話，送出審核時會自動產生（已經有網址的畫家會沿用原本的）。"; field.classList.remove("is-invalid"); return; }
    if(!SLUG_RE.test(v) || v.length < 2){
      n.textContent = "只能用英文小寫、數字和 -（- 不能放在開頭或結尾），至少 2 個字。";
      field.classList.add("is-invalid");
      return;
    }
    field.classList.remove("is-invalid");
    var u = new URL("artist.html?slug=" + v, location.href);
    n.textContent = "畫家頁網址：" + u.host + u.pathname + u.search;
  }

  var portraitBusy = false;
  function renderPortrait(){
    var pick = slot("portrait-pick");
    var input = byId("a-portrait");
    Array.prototype.slice.call(pick.childNodes).forEach(function(n){ if(n !== input) n.remove(); });
    pick.classList.toggle("has-img", !!state.portrait);
    pick.classList.toggle("is-busy", portraitBusy);
    if(state.portrait){
      var img = el("img", { attrs: { alt: "", decoding: "async" } });
      img.onerror = function(){ img.remove(); };
      C.thumb(img, state.portrait);                // 縮圖（js/images.js），沒有就自動改用大圖
      pick.insertBefore(img, input);
      pick.insertBefore(el("span", { class: "pick-change", text: portraitBusy ? "上傳中…" : "換一張" }), input);
    }else{
      pick.insertAdjacentHTML("afterbegin", ICON.person);
      pick.insertBefore(el("span", { text: portraitBusy ? "上傳中…" : "上傳" }), input);
    }
    document.querySelector('[data-action="remove-portrait"]').hidden = !state.portrait || portraitBusy;
  }

  byId("a-portrait").addEventListener("change", function(){
    var input = this, file = input.files && input.files[0];
    input.value = "";
    if(!file || portraitBusy) return;
    var msg = slot("portrait-status");
    portraitBusy = true; state.uploads++;
    msg.textContent = "上傳中…"; msg.className = "pick-status";
    renderPortrait(); updateButtons();
    upload(file).then(function(r){
      state.portrait = r.url;
      msg.textContent = "已上傳，記得按最下面的按鈕儲存。";
      markDirty();
      renderHead();
    }, function(err){
      msg.textContent = err.message || "上傳失敗，請再試一次。";
      msg.className = "pick-status is-bad";
    }).then(function(){
      portraitBusy = false; state.uploads--;
      renderPortrait(); updateButtons();
    });
  });

  document.querySelector('[data-action="remove-portrait"]').addEventListener("click", function(){
    state.portrait = null;
    slot("portrait-status").textContent = "已拿掉頭像，儲存後生效。";
    markDirty();
    renderPortrait();
    renderHead();
  });

  /* ============================================================
     作品
     ============================================================ */
  function toEditable(w){
    return {
      _key: ++keySeq, _msg: "", _bad: false, _uploading: false,
      id: w.id || null, title: str(w.title), image_url: w.image_url || null,
      image_w: w.image_w || null, image_h: w.image_h || null,
      medium: str(w.medium), support: str(w.support),
      width_cm: str(w.width_cm), height_cm: str(w.height_cm),
      price_min: str(w.price_min), price_max: str(w.price_max),
      status: w.status || "available", year: str(w.year), description: str(w.description)
    };
  }

  function options(list, current, placeholder){
    var out = [];
    if(placeholder != null) out.push(el("option", { text: placeholder, attrs: { value: "" } }));
    list.forEach(function(o){
      var value = Array.isArray(o) ? o[0] : o, label = Array.isArray(o) ? o[1] : o;
      var opt = el("option", { text: label, attrs: { value: value } });
      if(value === current) opt.selected = true;
      out.push(opt);
    });
    return out;
  }

  function input(w, key, attrs, tag){
    var n = el(tag || "input", { class: "ctrl", attrs: attrs });
    n.value = w[key];
    n.addEventListener(tag === "select" ? "change" : "input", function(){ w[key] = n.value; });
    return n;
  }

  function fieldBox(labelText, ctrlId, ctrl, opt){
    opt = opt || {};
    var label = el("label", { class: "q", attrs: { for: ctrlId } }, [labelText]);
    if(opt.req) label.appendChild(el("span", { class: "req", text: " *", attrs: { "aria-hidden": "true" } }));
    return el("div", { class: "field" }, [label, opt.hint ? el("span", { class: "hint", text: opt.hint, attrs: { id: ctrlId + "-hint" } }) : null, ctrl]);
  }

  function pairBox(labelText, id, a, b, sep){
    return el("div", { class: "field" }, [
      el("span", { class: "q", text: labelText, attrs: { id: id } }),
      el("div", { class: "pair", attrs: { role: "group", "aria-labelledby": id } }, [a, el("span", { text: sep }), b])
    ]);
  }

  function iconBtn(act, label, disabled){
    var b = el("button", { class: "icon-btn", attrs: { type: "button", "data-act": act, "aria-label": label } });
    b.insertAdjacentHTML("afterbegin", ICON[act]);
    if(disabled) b.disabled = true;
    return b;
  }

  /* 作品圖片框：已經有圖 → 顯示圖＋「換一張」；沒有 → 上傳提示 */
  function paintPicker(w){
    var e = w._els;
    if(!e) return;
    var pick = e.pick, file = e.file;
    Array.prototype.slice.call(pick.childNodes).forEach(function(n){ if(n !== file) n.remove(); });
    pick.classList.toggle("has-img", !!w.image_url);
    pick.classList.toggle("is-busy", w._uploading);
    if(w.image_url){
      var img = el("img", { attrs: { alt: "", decoding: "async", loading: "lazy" } });
      img.onerror = function(){ img.remove(); };
      C.thumb(img, w.image_url);
      pick.insertBefore(img, file);
      pick.insertBefore(el("span", { class: "pick-change", text: w._uploading ? "上傳中…" : "換一張" }), file);
    }else{
      pick.insertAdjacentHTML("afterbegin", ICON.image);
      pick.insertBefore(el("span", { text: w._uploading ? "上傳中…" : "點這裡上傳圖片" }), file);
      pick.insertBefore(el("span", { class: "pick-note", text: "JPG／PNG／WebP，5MB 內" }), file);
    }
    e.status.textContent = w._msg || "";
    e.status.className = "pick-status" + (w._bad ? " is-bad" : "");
  }

  function uploadWorkImage(w, file){
    if(!file || w._uploading) return;
    w._uploading = true; w._msg = "上傳中…"; w._bad = false;
    state.uploads++;
    paintPicker(w); updateButtons();
    upload(file).then(function(r){
      w.image_url = r.url; w.image_w = r.w; w.image_h = r.h;
      w._msg = "已上傳，記得按最下面的按鈕儲存。";
      markDirty();
      if(state.works[0] === w) renderHead();
    }, function(err){
      w._msg = err.message || "上傳失敗，請再試一次。";
      w._bad = true;
    }).then(function(){
      w._uploading = false;
      state.uploads--;
      paintPicker(w); updateButtons();
    });
  }

  function workCard(w, i, n){
    var k = "w" + w._key, no = i + 1;
    var file = el("input", { attrs: { type: "file", accept: "image/jpeg,image/png,image/webp", "aria-label": "上傳作品 " + no + " 的圖片" } });
    var pick = el("label", { class: "pick" }, [file]);
    var status = el("p", { class: "pick-status", attrs: { role: "status" } });
    w._els = { pick: pick, file: file, status: status };
    file.addEventListener("change", function(){
      var f = file.files && file.files[0];
      file.value = "";
      uploadWorkImage(w, f);
    });

    var medium = input(w, "medium", { id: k + "-medium", "aria-describedby": k + "-medium-hint" }, "select");
    options(MEDIUMS, w.medium, "請選擇").forEach(function(o){ medium.appendChild(o); });
    var support = input(w, "support", { id: k + "-support", "aria-describedby": k + "-support-hint" }, "select");
    options(SUPPORTS, w.support, "不填").forEach(function(o){ support.appendChild(o); });
    function syncSupport(){
      var digital = w.medium === "電繪";
      if(digital){ support.value = ""; w.support = ""; }
      support.disabled = digital;
    }
    medium.addEventListener("change", syncSupport);
    syncSupport();

    var wStatus = input(w, "status", { id: k + "-status" }, "select");
    options(WORK_STATUS, w.status).forEach(function(o){ wStatus.appendChild(o); });

    var desc = input(w, "description", { id: k + "-desc", rows: "3", maxlength: "1000" }, "textarea");
    desc.classList.add("ctrl--short");

    var card = el("div", { class: "work-edit", attrs: { "data-key": w._key } }, [
      el("div", { class: "work-edit-head" }, [
        el("h3", { text: "作品 " + no + (i === 0 ? "（封面）" : "") }),
        el("div", { class: "work-tools" }, [
          iconBtn("up", "把作品 " + no + " 往前移", i === 0),
          iconBtn("down", "把作品 " + no + " 往後移", i === n - 1),
          iconBtn("remove", "刪除作品 " + no)
        ])
      ]),
      el("div", { class: "work-edit-grid" }, [
        el("div", {}, [pick, status]),
        el("div", {}, [
          fieldBox("作品名稱", k + "-title", input(w, "title", { id: k + "-title", maxlength: "60" }), { req: true }),
          el("div", { class: "field-row" }, [
            fieldBox("媒材", k + "-medium", medium, { req: true, hint: "膠彩包含礦物顏料；素描包含鉛筆、炭筆。" }),
            fieldBox("畫在什麼上（選填）", k + "-support", support, { hint: "電繪不用選。" })
          ]),
          el("div", { class: "field-row" }, [
            pairBox("尺寸（cm）", k + "-size",
              input(w, "width_cm", { type: "number", min: "0", step: "0.1", inputmode: "decimal", placeholder: "寬", "aria-label": "寬（cm）" }),
              input(w, "height_cm", { type: "number", min: "0", step: "0.1", inputmode: "decimal", placeholder: "高", "aria-label": "高（cm）" }), "×"),
            fieldBox("年份", k + "-year", input(w, "year", { id: k + "-year", type: "number", min: "1900", max: "2100", step: "1", inputmode: "numeric", placeholder: "例如 2026" }))
          ]),
          el("div", { class: "field-row" }, [
            pairBox("價格（NT$）", k + "-price",
              input(w, "price_min", { type: "number", min: "1", step: "100", inputmode: "numeric", placeholder: "價格", "aria-label": "價格或最低價" }),
              input(w, "price_max", { type: "number", min: "1", step: "100", inputmode: "numeric", placeholder: "上限（選填）", "aria-label": "價格上限（選填）" }), "–"),
            fieldBox("狀態", k + "-status", wStatus)
          ]),
          fieldBox("作品說明（選填）", k + "-desc", desc)
        ])
      ])
    ]);
    paintPicker(w);
    return card;
  }

  function renderWorks(focusKey, focusAct){
    var list = slot("works");
    var n = state.works.length;
    C.fill(list, state.works.map(function(w, i){ return workCard(w, i, n); }));
    if(!n) list.appendChild(el("div", { class: "empty" }, [el("p", { text: "還沒有作品。按下面的「新增作品」開始放第一件，第一件會當作封面。" })]));
    slot("nav-works").textContent = n + "/" + MAX_WORKS;
    slot("add-work-label").textContent = n >= MAX_WORKS ? "已經放滿 9 件" : "新增作品（" + n + " / " + MAX_WORKS + "）";
    document.querySelector('[data-action="add-work"]').disabled = n >= MAX_WORKS;
    if(focusKey){
      var card = list.querySelector('[data-key="' + focusKey + '"]');
      var target = card && (focusAct ? card.querySelector('[data-act="' + focusAct + '"]:not(:disabled)') : card.querySelector("input.ctrl"));
      if(target) target.focus();
      else if(card) card.querySelector('[data-act="remove"]').focus();
    }
  }

  slot("works").addEventListener("click", function(e){
    var b = e.target.closest("[data-act]");
    if(!b) return;
    var card = b.closest("[data-key]");
    var i = -1;
    state.works.forEach(function(w, j){ if(String(w._key) === card.getAttribute("data-key")) i = j; });
    if(i < 0) return;
    var w = state.works[i], act = b.getAttribute("data-act");
    if(act === "remove"){
      var name = w.title ? "「" + w.title + "」" : "";
      if((w.id || w.image_url || w.title) && !confirm("確定要刪除作品 " + (i + 1) + name + " 嗎？按最下面的按鈕儲存後才會真的刪除。")) return;
      state.works.splice(i, 1);
      markDirty();
      var next = state.works[Math.min(i, state.works.length - 1)];
      renderWorks(next ? next._key : null, "remove");
      if(!next) document.querySelector('[data-action="add-work"]').focus();
      renderHead();
      return;
    }
    var j = act === "up" ? i - 1 : i + 1;
    if(j < 0 || j >= state.works.length) return;
    state.works[i] = state.works[j];
    state.works[j] = w;
    markDirty();
    renderWorks(w._key, act);
    if(i === 0 || j === 0) renderHead();
  });

  document.querySelector('[data-action="add-work"]').addEventListener("click", function(){
    if(state.works.length >= MAX_WORKS) return;
    var w = toEditable({ status: "available" });
    state.works.push(w);
    markDirty();
    renderWorks(w._key);
    var card = slot("works").querySelector('[data-key="' + w._key + '"]');
    if(card && card.scrollIntoView) card.scrollIntoView({ block: "start", behavior: "smooth" });
  });

  /* ============================================================
     儲存
     ============================================================ */
  function numOrNull(v){ v = str(v).trim(); return v === "" ? null : v; }

  function collect(){
    var tags = byId("a-tags").value.split(/[,，、]/).map(function(t){ return t.trim(); }).filter(Boolean);
    var data = {
      name: byId("a-name").value,
      tags: tags,
      tagline: byId("a-tagline").value,
      story: byId("a-story").value,
      portrait_url: state.portrait,
      email: byId("a-email").value.trim(),
      instagram: byId("a-ig").value.trim().replace(/^@/, ""),
      location: byId("a-location").value || null,
      custom_ok: (form.querySelector('input[name="custom_ok"]:checked') || {}).value === "true",
      custom_note: byId("a-custom").value,
      works: state.works.map(function(w){
        return {
          id: w.id, title: w.title, image_url: w.image_url, image_w: w.image_w, image_h: w.image_h,
          medium: w.medium || null, support: w.medium === "電繪" ? null : (w.support || null),
          width_cm: numOrNull(w.width_cm), height_cm: numOrNull(w.height_cm),
          price_min: numOrNull(w.price_min), price_max: numOrNull(w.price_max),
          status: w.status || "available", year: numOrNull(w.year), description: w.description
        };
      })
    };
    if(state.mode === "admin"){
      data.sort_order = numOrNull(byId("a-sort").value);
      data.slug = byId("a-slug").value.trim().toLowerCase();   // 只有管理者能改網址
    }else{
      data.slug = str(state.data.artist.slug);   // 畫家：原樣送回目前的網址（資料庫其實會忽略、沿用原本的；送回去是讓還沒跑 sql/05 時不會把網址清掉）
    }
    return data;
  }

  function savedMessage(before, submit, d){
    if(before.mode === "admin") return d.artist.status === "approved" ? "已儲存，網站上已經更新。" : "已儲存。";
    if(before.mode === "revision"){
      if(submit) return "已送出審核。通過前網站上維持目前的版本。";
      return d.revision && d.revision.status === "pending" ? "已更新送審的內容。" : "已儲存，還沒送出審核（網站上還是目前的版本）。";
    }
    if(submit) return "已送出審核！通過後就會出現在網站上。";
    return before.status === "pending" ? "已儲存，審核時會看到最新的內容。" : "已儲存。";
  }

  function save(submit){
    if(state.busy) return;
    if(state.uploads > 0){ setStatus("圖片還在上傳，等一下再儲存。", "bad"); return; }
    var slugField = byId("a-slug").closest(".field");
    if(state.mode === "admin" && slugField.classList.contains("is-invalid")){
      setStatus("畫家頁網址格式不對，請先改好。", "bad");
      byId("a-slug").focus();
      return;
    }
    var before = { mode: state.mode, status: state.data.artist.status };
    state.busy = true; updateButtons();
    setStatus(submit ? "送出中…" : "儲存中…");
    ArchDB.saveArtist(state.artistId, collect(), submit).then(function(d){
      d.owner = state.data.owner;
      d.mode = d.mode || state.mode;
      state.dirty = false;
      load(d);
      setStatus(savedMessage(before, submit, d), "ok");
      ArchAuth.refresh();       // 頁首選單、我的帳號裡的畫家狀態
    }).catch(function(err){
      setStatus((err && err.message) || "儲存失敗，請再試一次。", "bad");
    }).then(function(){
      state.busy = false; updateButtons();
    });
  }

  form.addEventListener("submit", function(e){
    e.preventDefault();
    save(state.submitMeans);
  });
  slot("save-btn").addEventListener("click", function(){ save(false); });

  function discardRevision(){
    if(state.busy) return;
    if(!confirm("確定要放棄這次的修改嗎？畫家資料和作品會回到網站上目前的版本。")) return;
    state.busy = true; updateButtons();
    setStatus("處理中…");
    ArchDB.discardRevision(state.artistId).then(function(){
      return ArchDB.studioLoad(state.artistId);
    }).then(function(d){
      d.owner = state.data.owner;
      state.dirty = false;
      load(d);
      setStatus("已放棄修改，回到網站上目前的版本。", "ok");
      ArchAuth.refresh();
    }).catch(function(err){
      setStatus((err && err.message) || "沒有成功，請再試一次。", "bad");
    }).then(function(){
      state.busy = false; updateButtons();
    });
  }

  /* 表單有改動：離開頁面前提醒 */
  form.addEventListener("input", function(e){
    if(e.target.type === "file") return;
    markDirty();
    if(e.target.id === "a-slug") updateSlugPreview();
    if(e.target.id === "a-tagline") updateCounters();
    if(e.target.id === "a-name") renderHead();
  });
  form.addEventListener("change", function(e){ if(e.target.type !== "file") markDirty(); });
  window.addEventListener("beforeunload", function(e){
    if(state.dirty || state.uploads > 0){ e.preventDefault(); e.returnValue = ""; }
  });

  /* ============================================================
     讀取
     ============================================================ */
  function load(d){
    state.data = d;
    state.mode = d.mode || "direct";
    state.artistId = d.artist.id;
    var useRevision = state.mode === "revision" && d.revision && d.revision.data;
    var src = useRevision ? d.revision.data : d.artist;
    var works = useRevision ? (d.revision.data.works || []) : (d.works || []);
    fillProfile(src);
    state.works = works.map(toEditable);
    renderWorks();
    renderHead();
    renderNotices();
    configureActions();
  }

  var reloadBtn = document.querySelector('[data-action="reload"]');
  if(reloadBtn) reloadBtn.addEventListener("click", function(){ location.reload(); });

  function fail(msg){
    slot("error-msg").textContent = msg || "請檢查網路後再試一次。";
    C.showState("error");
  }

  ArchAuth.requirePage().then(function(me){
    if(!me) return;                                  // 已經被送去登入頁
    var target = params.get("artist");
    if(target && !me.is_admin) target = null;        // 只有管理者能指定畫家
    if(target && !UUID_RE.test(target)){ fail("網址裡的畫家編號不正確，請從管理後台重新點「編輯」。"); return; }
    ArchDB.studioLoad(target).then(function(d){
      if(!d){
        if(me.is_admin){ C.showState("none"); return; }
        location.replace("apply.html");              // 還沒有畫家頁：先去申請
        return;
      }
      load(d);
      C.showState("ready");
      if(state.mode === "admin") document.title = "編輯 " + (d.artist.name || "畫家") + "｜Arch";
    }).catch(function(err){ fail(err && err.message); });
  });
})();
