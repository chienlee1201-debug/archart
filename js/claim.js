/* ============================================================
   claim.js — 認領畫家頁（claim.html?token=<認領碼>，PLAN 5.2）
   需要先載入：config.js、supabase-js、db.js、auth.js、cards.js

   1. 用認領碼讀預覽（arch_claim_preview，訪客也能讀）：名字、頭像、作品縮圖
   2. 訪客按「用 Google 登入並認領」→ 記下「回來要認領」→ Google 登入 → 回到這一頁自動認領
      已登入的人按「認領到這個帳號」
   3. 認領成功（arch_claim_artist）→ 進畫家後台 studio.html?claimed=1
   例外：連結失效 → 「這個連結已經失效」；帳號已經有畫家頁 → 不認領，請對方聯絡我們
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards;
  if(!C || !window.ArchDB || !window.ArchAuth) return;
  var el = C.el;

  var FLAG = "arch.claim";      // sessionStorage：登入回來後要自動認領的認領碼
  var token = (new URLSearchParams(location.search).get("token") || "").trim();
  var preview = null;

  function slot(n){ return document.querySelector('[data-slot="' + n + '"]'); }

  function setFlag(){ try{ sessionStorage.setItem(FLAG, token); }catch(e){} }
  function readFlag(){ try{ return sessionStorage.getItem(FLAG); }catch(e){ return null; } }
  function clearFlag(){ try{ sessionStorage.removeItem(FLAG); }catch(e){} }

  function setStatus(text, bad){
    var n = slot("claim-status");
    n.textContent = text || "";
    n.className = "claim-status" + (bad ? " is-bad" : "");
  }

  function renderPreview(p){
    slot("name").textContent = p.name || "（還沒有名字）";
    document.title = "認領" + (p.name ? "「" + p.name + "」" : "畫家頁") + "｜Arch";
    C.fillAvatar(slot("avatar"), { name: p.name, portrait_url: p.portrait_url, works: p.works || [] });
    var works = (p.works || []).filter(function(w){ return w.image_url; }).slice(0, 9);
    C.fill(slot("works"), works.map(function(w){
      var box = el("div", { class: "claim-thumb" });
      var img = el("img", { attrs: { alt: w.title ? "作品〈" + w.title + "〉" : "作品", loading: "lazy", decoding: "async" } });
      img.onerror = function(){ img.remove(); };
      C.thumb(img, w.image_url);
      box.appendChild(img);
      return box;
    }));
    slot("works").hidden = !works.length;
  }

  function showActions(me){
    slot("guest-actions").hidden = !!me;
    slot("user-actions").hidden = !me;
    if(me) slot("claim-email").textContent = me.email || me.display_name || "目前的帳號";
  }

  function showInvalid(me){
    clearFlag();
    slot("invalid-studio").hidden = !(me && me.artist);
    document.title = "連結已經失效｜Arch";
    C.showState("invalid");
  }

  function claim(){
    clearFlag();
    setStatus("");
    C.showState("claiming");
    ArchDB.claimArtist(token).then(function(r){
      var result = r && r.result;
      if(result === "ok"){
        var go = function(){ location.replace("studio.html?claimed=1"); };
        ArchAuth.refresh().then(go, go);
        return;
      }
      var me = ArchAuth.me();
      if(result === "has_artist"){
        slot("has-email").textContent = (me && me.email) || "目前的帳號";
        C.showState("has-artist");
        return;
      }
      showInvalid(me);
    }).catch(function(err){
      C.showState("preview");
      setStatus(((err && err.message) || "認領沒有成功") + "，請再試一次。", true);
    });
  }

  /* ---------- 按鈕 ---------- */
  document.getElementById("claim-login").addEventListener("click", function(){
    var btn = this, label = btn.querySelector("span");
    setFlag();
    btn.disabled = true;
    label.textContent = "正在前往 Google…";
    ArchAuth.login(window.ArchChrome ? window.ArchChrome.herePath() : "claim.html?token=" + encodeURIComponent(token))
      .then(function(ok){
        if(ok) return;
        clearFlag(); btn.disabled = false; label.textContent = "用 Google 登入並認領";
      }, function(){
        clearFlag(); btn.disabled = false; label.textContent = "用 Google 登入並認領";
        setStatus("登入沒有成功，請再試一次。如果一直失敗，請聯絡我們。", true);
      });
  });

  document.getElementById("claim-go").addEventListener("click", claim);

  Array.prototype.forEach.call(document.querySelectorAll('[data-act="switch"]'), function(b){
    b.addEventListener("click", function(){
      b.disabled = true;
      ArchAuth.logout().then(function(){
        b.disabled = false;
        if(!preview){ location.reload(); return; }
        showActions(null);
        setStatus("");
        C.showState("preview");
      });
    });
  });

  var reloadBtn = document.querySelector('[data-action="reload"]');
  if(reloadBtn) reloadBtn.addEventListener("click", function(){ location.reload(); });

  /* ---------- 開始 ---------- */
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)){   // 沒有認領碼或格式不對
    ArchAuth.ready.then(showInvalid);
    return;
  }
  Promise.all([ArchAuth.ready, ArchDB.claimPreview(token)]).then(function(r){
    var me = r[0], p = r[1];
    if(!p){ showInvalid(me); return; }
    preview = p;
    renderPreview(p);
    showActions(me);
    if(me && readFlag() === token){ claim(); return; }   // 剛登入回來：自動認領
    C.showState("preview");
  }).catch(function(err){
    slot("error-msg").textContent = (err && err.message) || "請檢查網路後再試一次。";
    C.showState("error");
  });
})();
