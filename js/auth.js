/* ============================================================
   auth.js — Google 登入、登出、依登入狀態切換畫面
   需要先載入：config.js、supabase-js（CDN）、site-chrome.js、db.js

   · 按鈕 [data-action="login-google"]：前往 Google 登入，登入完回到「目前這一頁」
     （在 login.html 上則回到網址 ?next= 指定的頁面）
   · 按鈕 [data-action="logout"]：登出
   · 需要登入才能做的動作：在按鈕加 data-login-reason="送出詢問"（並給它一個 id）
       已登入 → 照常執行；訪客 → 跳出「先登入再繼續」提示，登入回來後自動再按一次那個按鈕
   · 需要登入才能看的頁面：ArchAuth.requirePage().then(function(me){ … })
       訪客會被送到 login.html?next=這一頁，登入完再回來

   轉回網址一律用「目前網頁的位置」算出來，本機、GitHub Pages（/archart/）、自訂網域都適用。
   Supabase 後台 Authentication → URL Configuration → Redirect URLs 必須包含這些網址（見 SETUP.md）。
   ============================================================ */
(function(){
  "use strict";

  var cfg = window.ARCH_CONFIG || {};
  var PENDING_KEY = "arch.pending";
  var PENDING_MAX_AGE = 30 * 60 * 1000;    // 30 分鐘內登入回來才自動接著做
  var GUARDED_PAGES = ["account", "studio", "admin"];   // 登出後要離開的頁面

  var client = null;
  try{
    if(window.supabase && cfg.supabaseUrl && cfg.supabaseKey){
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
  }catch(e){ client = null; }

  var state = { known: false, user: null, me: null };
  var page = document.body.getAttribute("data-page") || "";

  function chrome(){ return window.ArchChrome || { setMe: function(){}, herePath: function(){ return "index.html"; } }; }

  var domReady = new Promise(function(res){
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", res);
    else res();
  });

  /* ---------- 網址 ---------- */

  /* login.html?next=… 只接受本站的頁面（例如 account.html、artist.html?slug=x），避免被拿來轉去別的網站 */
  function nextFromQuery(){
    var n = new URLSearchParams(location.search).get("next") || "";
    return /^[A-Za-z0-9_-]+\.html(\?[^#]*)?(#.*)?$/.test(n) ? n : null;
  }

  function absolute(path){
    var u = new URL(path, location.href);
    u.hash = "";
    return u.href;
  }

  /* 登入回來後，把網址上的登入參數拿掉 */
  function cleanUrl(){
    var u = new URL(location.href);
    var changed = false;
    ["code", "error", "error_code", "error_description", "state"].forEach(function(k){
      if(u.searchParams.has(k)){ u.searchParams.delete(k); changed = true; }
    });
    if(changed) history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  }

  /* ---------- 讀取登入狀態 ---------- */

  /* arch_me 失敗（例如資料庫還沒建好）時，先用 Google 帳號的基本資料撐著 */
  function fallbackMe(user){
    var m = user.user_metadata || {};
    return {
      id: user.id, email: user.email || "",
      display_name: m.full_name || m.name || "",
      avatar_url: m.avatar_url || m.picture || "",
      is_admin: false, artist: null, partial: true
    };
  }

  function load(){
    if(!client) return Promise.resolve(null);
    return client.auth.getSession().then(function(r){
      var session = r && r.data && r.data.session;
      state.user = session ? session.user : null;
      if(!state.user) return null;
      return window.ArchDB.getMe().then(function(me){
        return me || fallbackMe(state.user);
      }, function(err){
        if(window.console) console.warn("[Arch] 讀取帳號資料失敗：", err && err.cause || err);
        return fallbackMe(state.user);
      });
    }).catch(function(err){
      if(window.console) console.warn("[Arch] 讀取登入狀態失敗：", err);
      return null;
    });
  }

  function setMe(me){
    state.me = me || null;
    state.known = true;
    chrome().setMe(state.me);
    return state.me;
  }

  var ready = Promise.all([load(), domReady]).then(function(r){
    setMe(r[0]);
    cleanUrl();
    if(state.me) replayPending();
    return state.me;
  });

  function refresh(){
    return load().then(setMe);
  }

  /* 其他分頁登入／登出時同步（不能在這個 callback 裡直接呼叫 Supabase，所以延後一下） */
  if(client){
    client.auth.onAuthStateChange(function(event){
      if(!state.known) return;
      if(event === "SIGNED_OUT"){ setTimeout(function(){ setMe(null); }, 0); }
      else if(event === "SIGNED_IN" && !state.me){ setTimeout(refresh, 0); }
    });
  }

  /* ---------- 登入、登出 ---------- */

  function login(path){
    if(!client){
      alert("暫時連不上登入服務，請檢查網路後重新整理頁面。");
      return Promise.resolve(false);
    }
    return client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: absolute(path || chrome().herePath()) }
    }).then(function(r){
      if(r.error) throw r.error;
      return true;          // 瀏覽器會自動前往 Google
    });
  }

  function logout(){
    var done = function(){
      try{ sessionStorage.removeItem(PENDING_KEY); }catch(e){}
      setMe(null);
      if(GUARDED_PAGES.indexOf(page) > -1) location.href = "index.html";
    };
    if(!client){ done(); return Promise.resolve(); }
    return client.auth.signOut({ scope: "local" }).then(done, done);
  }

  /* ---------- 「按下時才登入」 ---------- */

  var leavingForLogin = false;

  function savePending(replayId, data){
    try{
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        path: chrome().herePath(), replay: replayId || "", data: data || null, t: Date.now()
      }));
    }catch(e){}
  }

  function readPending(){
    try{
      var p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
      if(!p || Date.now() - p.t > PENDING_MAX_AGE) return null;
      return p;
    }catch(e){ return null; }
  }

  function clearPending(){ try{ sessionStorage.removeItem(PENDING_KEY); }catch(e){} }

  /* 登入回到原頁後，替使用者再按一次剛剛的按鈕 */
  function replayPending(){
    var p = readPending();
    if(!p || p.path !== chrome().herePath()) return;
    clearPending();
    state.pendingData = p.data;
    var el = p.replay && document.getElementById(p.replay);
    if(el) el.click();
  }

  /* 跳出「先登入再繼續」提示；reason 例如「送出詢問」 */
  function prompt(reason, replayId, data){
    var dlg = document.getElementById("login-dialog");
    savePending(replayId, data);
    if(!dlg || !dlg.showModal){ login(); return; }
    var lead = dlg.querySelector('[data-slot="login-reason"]');
    if(lead) lead.textContent = reason ? "登入後就能" + reason + "。" : "登入後就能繼續。";
    leavingForLogin = false;
    if(!dlg.__archBound){
      dlg.__archBound = true;
      dlg.addEventListener("close", function(){ if(!leavingForLogin) clearPending(); });
    }
    dlg.showModal();
  }

  /* 給之後的頁面程式用：已登入回傳 true（照常做）；訪客跳出提示並回傳 false */
  function requireLogin(reason, replayId, data){
    return ready.then(function(me){
      if(me) return true;
      prompt(reason, replayId, data);
      return false;
    });
  }

  /* 需要登入才能看的頁面 */
  function requirePage(){
    return ready.then(function(me){
      if(!me) location.replace("login.html?next=" + encodeURIComponent(chrome().herePath()));
      return me;
    });
  }

  /* ---------- 點擊 ---------- */

  // 需要登入的按鈕：在其他程式（例如 ui.js 打開對話框）之前攔下來
  document.addEventListener("click", function(e){
    var el = e.target.closest && e.target.closest("[data-login-reason]");
    if(!el || el.__archPass) return;
    if(state.known && state.me) return;                       // 已登入：照常
    e.preventDefault();
    e.stopImmediatePropagation();
    var reason = el.getAttribute("data-login-reason");
    if(state.known){ prompt(reason, el.id); return; }        // 訪客
    ready.then(function(me){                                  // 還在確認登入狀態：等一下再決定
      if(!me){ prompt(reason, el.id); return; }
      el.__archPass = true;
      try{ el.click(); } finally { el.__archPass = false; }
    });
  }, true);

  document.addEventListener("click", function(e){
    var t = e.target.closest && e.target.closest('[data-action="login-google"],[data-action="logout"]');
    if(!t) return;
    e.preventDefault();

    if(t.getAttribute("data-action") === "logout"){
      t.disabled = true;
      logout().then(function(){ t.disabled = false; });
      return;
    }

    var label = t.lastChild && t.lastChild.nodeType === 3 ? t.lastChild : null;
    var original = label ? label.nodeValue : "";
    leavingForLogin = true;
    t.disabled = true;
    if(label) label.nodeValue = "正在前往 Google…";
    var target = page === "login" ? (nextFromQuery() || "index.html") : chrome().herePath();
    login(target).catch(function(err){
      if(window.console) console.warn("[Arch] 登入失敗：", err);
      leavingForLogin = false;
      t.disabled = false;
      if(label) label.nodeValue = original;
      alert("登入沒有成功，請再試一次。如果一直失敗，請聯絡我們。");
    });
  });

  window.ArchAuth = {
    client: client,
    ready: ready,
    refresh: refresh,
    me: function(){ return state.me; },
    user: function(){ return state.user; },
    pendingData: function(){ return state.pendingData || null; },
    login: login,
    logout: logout,
    requireLogin: requireLogin,
    requirePage: requirePage,
    nextFromQuery: nextFromQuery
  };
})();
