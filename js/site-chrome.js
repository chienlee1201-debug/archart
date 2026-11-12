/* ============================================================
   site-chrome.js — 全站共用的頁首、頁尾、登入提示對話框（純介面，不碰資料庫）
   用法（每一頁）：
     <body data-page="artists">            ← 這一頁的名字（檔名去掉 .html）；導覽列依此把目前所在的分類標粗體
     <script src="js/site-chrome.js"></script>   ← 放在 <body> 最前面，頁首會直接畫在這個位置
     …頁面內容…
     <div id="site-footer"></div>           ← 頁尾會換到這裡
   登入狀態由 auth.js 呼叫 ArchChrome.setMe(me) 更新；這裡先用上次記下的資料畫，避免「登入」閃一下。
   ============================================================ */
(function(){
  "use strict";

  var ME_KEY = "arch.me";

  var LOGO = '<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 15.5 10 10.5 13 14 15.5 11.5 18 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  var ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>';
  var ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
  var ICON_IG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/></svg>';
  var ICON_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  var ICON_GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  /* 主選單：[網址, 文字, data-page 值] */
  var NAV = [
    ["artists.html", "找畫家", "artists"],
    ["explore.html", "作品探索", "explore"],
    ["wishes.html", "許願牆", "wishes"],
    ["about.html", "關於 Arch", "about"]
  ];

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }

  function readCache(){
    try{ return JSON.parse(localStorage.getItem(ME_KEY) || "null"); }catch(e){ return null; }
  }

  /* 目前這一頁的相對網址（給「登入」帶回來用），例如 artists.html?x=1 */
  function herePath(){
    var file = location.pathname.split("/").pop() || "index.html";
    return file + location.search;
  }

  var page = (document.body && document.body.getAttribute("data-page")) || "";
  var section = { artist: "artists", work: "artists", wish: "wishes" }[page] || page;   // 畫家頁、作品頁算在「找畫家」底下
  var me = readCache();

  function navLinks(){
    return NAV.map(function(n){
      var cur = n[2] && n[2] === section ? ' aria-current="page"' : "";
      return '<a href="' + n[0] + '"' + cur + ">" + n[1] + "</a>";
    }).join("\n      ");
  }

  function header(){
    var loginHref = page === "login" ? "login.html" : "login.html?next=" + encodeURIComponent(herePath());
    return '' +
'<header class="nav">\n' +
'  <div class="shell nav-in">\n' +
'    <a class="brand" href="index.html">' + LOGO + '<span class="brand-txt">Arch</span></a>\n' +
'    <nav class="nav-links" aria-label="主選單">\n      ' + navLinks() + '\n    </nav>\n' +
'    <div class="nav-actions">\n' +
'      <a class="icon-link" href="artists.html#search" aria-label="搜尋">' + ICON_SEARCH + '</a>\n' +
'      <a class="icon-link" href="account.html#favorites" aria-label="我的收藏">' + ICON_HEART + '</a>\n' +
'      <a class="btn btn--sm" href="' + loginHref + '" data-auth="guest"' + (me ? " hidden" : "") + '>登入</a>\n' +
'      <details class="pop" data-auth="user"' + (me ? "" : " hidden") + '>\n' +
'        <summary aria-label="帳號選單"><span class="avatar avatar--sm" data-slot="me-avatar"></span></summary>\n' +
'        <div class="pop-panel">\n' +
'          <p class="pop-head"><strong data-slot="me-name"></strong><span data-slot="me-email"></span></p>\n' +
'          <hr>\n' +
'          <a href="account.html">我的帳號</a>\n' +
'          <a href="studio.html" data-role="artist" hidden>畫家後台</a>\n' +
'          <a href="admin.html" data-role="admin" hidden>管理後台</a>\n' +
'          <hr>\n' +
'          <button type="button" data-action="logout">登出</button>\n' +
'        </div>\n' +
'      </details>\n' +
'      <details class="pop mobile-menu">\n' +
'        <summary class="menu-btn" aria-label="開啟選單">' + ICON_MENU + '</summary>\n' +
'        <nav class="pop-panel" aria-label="手機選單">\n          ' + navLinks().replace(/ aria-current="page"/g, "") + '\n' +
'          <hr>\n' +
'          <a href="apply.html">成為畫家</a>\n' +
'        </nav>\n' +
'      </details>\n' +
'    </div>\n' +
'  </div>\n' +
'</header>';
  }

  /* 頁尾「關於」欄：Email 直接顯示信箱（沒有設定郵件程式的電腦也看得到、能複製）＋官方 Instagram。站主 Threads 只放在 about.html#contact */
  function footer(){
    return '' +
'<footer class="foot">\n' +
'  <div class="shell">\n' +
'    <div class="foot-top">\n' +
'      <div>\n' +
'        <a class="brand" href="index.html">' + LOGO + '<span class="brand-txt">Arch</span></a>\n' +
'        <p class="foot-tag">讓每個值得紀念的時刻，都留下一幅畫。</p>\n' +
'      </div>\n' +
'      <div class="foot-cols">\n' +
'        <div class="foot-col">\n' +
'          <h2>逛逛</h2>\n' +
'          <ul>\n' +
'            <li><a href="artists.html">找畫家</a></li>\n' +
'            <li><a href="explore.html">作品探索</a></li>\n' +
'            <li><a href="wishes.html">許願牆</a></li>\n' +
'          </ul>\n' +
'        </div>\n' +
'        <div class="foot-col">\n' +
'          <h2>畫家</h2>\n' +
'          <ul>\n' +
'            <li><a href="apply.html">成為畫家</a></li>\n' +
'            <li><a href="studio.html">畫家後台</a></li>\n' +
'          </ul>\n' +
'        </div>\n' +
'        <div class="foot-col">\n' +
'          <h2>關於</h2>\n' +
'          <ul>\n' +
'            <li><a href="about.html">關於 Arch</a></li>\n' +
'            <li><a href="about.html#faq">常見問題</a></li>\n' +
'            <li><a href="mailto:archarttw@gmail.com" aria-label="寄信給 Arch：archarttw@gmail.com">' + ICON_MAIL + 'archarttw@gmail.com</a></li>\n' +
'            <li><a href="https://www.instagram.com/archarttw/" target="_blank" rel="noopener" aria-label="Arch 官方 Instagram @archarttw（另開新視窗）">' + ICON_IG + 'Instagram @archarttw</a></li>\n' +
'          </ul>\n' +
'        </div>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="foot-bottom">\n' +
'      <span>© 2026 Arch</span>\n' +
'      <span>交易於平台外完成，Arch 不經手金流。</span>\n' +
'    </div>\n' +
'  </div>\n' +
'</footer>';
  }

  /* 按下「詢問／許願」等需要登入的按鈕時跳出的提示（auth.js 決定何時打開） */
  function loginDialog(){
    return '' +
'<dialog class="dialog dialog--sm" id="login-dialog" aria-labelledby="login-dialog-title">\n' +
'  <div class="dialog-head">\n' +
'    <h2 id="login-dialog-title">先登入再繼續</h2>\n' +
'    <button class="close-btn" type="button" data-close aria-label="關閉">' + ICON_CLOSE + '</button>\n' +
'  </div>\n' +
'  <div class="dialog-body login-prompt">\n' +
'    <p class="login-prompt-lead" data-slot="login-reason">登入後就能繼續。</p>\n' +
'    <button class="btn btn--google" type="button" data-action="login-google">' + ICON_GOOGLE + '使用 Google 帳號登入</button>\n' +
'    <p class="login-prompt-note">不用另外設定密碼。登入完會回到這一頁。</p>\n' +
'    <button class="btn btn--ghost" type="button" data-close>先不用，繼續逛</button>\n' +
'  </div>\n' +
'</dialog>';
  }

  /* ---------- 依登入狀態切換畫面 ---------- */
  function initialOf(m){
    var s = (m && (m.display_name || m.email)) || "";
    return s ? Array.from(s.trim())[0].toUpperCase() : "";
  }

  function fillAvatar(el, m){
    var initial = initialOf(m);
    el.textContent = initial;
    if(m && m.avatar_url){
      var img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";        // Google 大頭貼帶 referrer 時偶爾會被擋
      img.decoding = "async";
      img.onerror = function(){ img.remove(); el.textContent = initial; };
      img.src = m.avatar_url;
      el.textContent = "";
      el.appendChild(img);
    }
  }

  function apply(root){
    var m = me;
    var q = function(sel){ return (root || document).querySelectorAll(sel); };
    Array.prototype.forEach.call(q('[data-auth="guest"]'), function(el){ el.hidden = !!m; });
    Array.prototype.forEach.call(q('[data-auth="user"]'), function(el){ el.hidden = !m; });
    Array.prototype.forEach.call(q('[data-role="admin"]'), function(el){ el.hidden = !(m && m.is_admin); });
    Array.prototype.forEach.call(q('[data-role="artist"]'), function(el){ el.hidden = !(m && m.artist); });
    if(!m) return;
    Array.prototype.forEach.call(q('[data-slot="me-name"]'), function(el){
      if(el.tagName === "INPUT") return;
      el.textContent = m.display_name || "Arch 會員";
    });
    Array.prototype.forEach.call(q('[data-slot="me-email"]'), function(el){
      if(el.tagName === "INPUT") return;
      el.textContent = m.email || "";
    });
    Array.prototype.forEach.call(q('[data-slot="me-avatar"]'), function(el){ fillAvatar(el, m); });
  }

  /* 給 auth.js 呼叫：me 為 null 代表訪客 */
  function setMe(next){
    me = next || null;
    try{
      if(me) localStorage.setItem(ME_KEY, JSON.stringify({
        display_name: me.display_name || "", email: me.email || "", avatar_url: me.avatar_url || "",
        is_admin: !!me.is_admin, artist: me.artist ? { status: me.artist.status } : null
      }));
      else localStorage.removeItem(ME_KEY);
    }catch(e){}
    apply();
  }

  /* ---------- 畫出來 ---------- */
  var self = document.currentScript;
  if(self) self.insertAdjacentHTML("beforebegin", header());
  apply(document.querySelector("header.nav"));

  document.addEventListener("DOMContentLoaded", function(){
    var slot = document.getElementById("site-footer");
    if(slot) slot.outerHTML = footer();
    if(!document.getElementById("login-dialog")) document.body.insertAdjacentHTML("beforeend", loginDialog());
    apply();
  });

  window.ArchChrome = { setMe: setMe, herePath: herePath, esc: esc };
})();
