/* ============================================================
   images.js — 圖片共用工具（純介面，不碰資料庫）
   需要先載入：config.js（用 supabaseUrl 判斷是不是正式版 arch-images 的圖片）

   · 縮圖命名規則（不改資料表，資料庫只存大圖網址）：
       大圖路徑去掉副檔名＋「-s.jpg」就是縮圖，跟大圖放在同一個資料夾
       例：<畫家 id>/abc.png → <畫家 id>/abc-s.jpg；demo/uploads/x.jpg → demo/uploads/x-s.jpg
       只對正式版 Storage「arch-images」的公開網址生效，其他網址（Google 頭像、外部圖片）原樣使用
   · 列表、卡片、頭像用縮圖（最長邊 800px）；作品頁大圖、探索頁手機大張滑卡用原圖
   · 顯示縮圖時把原圖網址記在 data-full：縮圖載入失敗（例如舊圖還沒補產生縮圖）自動改載原圖一次，
     原圖也失敗才會觸發那張圖自己的 onerror（色塊、首字）
   · 上傳前在瀏覽器把圖片縮成 JPG（畫家後台上傳、管理後台補產生縮圖共用）
   · Cloudflare 圖片轉送（2026-11-17，md/Cloudflare節流.md）：config.js 的 imageCdn 有填時，
       arch-images 的公開網址顯示時換成 imageCdn（例 https://img.archarttw.com/<路徑>），省 Supabase 流量。
       資料庫、上傳都不變，只在「顯示」時換算；imageCdn 留空 = 完全照舊。
       保險：CDN 的圖載入失敗 → 自動改從 Supabase 載同一張；同一個分頁 CDN 壞掉 2 次（Supabase 卻讀得到）
       就整個分頁（sessionStorage）停用 CDN，不再浪費時間先試 CDN。每一步都會消耗掉一個退路，不會無限重試。

   用法：
     ArchImg.url(url)               顯示用網址（arch-images 的圖換成 CDN；其他網址、CDN 關掉 → 原樣回傳）
     ArchImg.useFull(img, url)      <img> 顯示原圖（走 CDN，失敗自動退回 Supabase）
     ArchImg.thumbUrl(url)          縮圖網址（Supabase 網址，不換 CDN；不是 arch-images 的網址 → 原樣回傳）
     ArchImg.thumbPath(path)        Storage 路徑 → 縮圖路徑（db.js 上傳縮圖用）
     ArchImg.storagePath(url)       arch-images 公開網址 → Storage 路徑（不是 → null）
     ArchImg.useThumb(img, url)     <img> 顯示縮圖、失敗退回原圖
     ArchImg.fullAttr(url)          拼 HTML 字串用：回傳 { src, full }（都已換成顯示用網址；full 空字串 = 不用退回）
     ArchImg.load(blob)             Blob／File → 讀好的 <img>（Promise）
     ArchImg.toJpeg(img, 長邊上限, 品質)  → Promise { blob, w, h }（只縮小不放大，透明處填白底）
   ============================================================ */
(function(){
  "use strict";

  var cfg = window.ARCH_CONFIG || {};
  var BASE = String(cfg.supabaseUrl || "").replace(/\/+$/, "");
  var PUB = BASE ? BASE + "/storage/v1/object/public/arch-images/" : "";
  var SUFFIX = "-s.jpg";

  /* Cloudflare 圖片轉送：只接受 https:// 開頭的網址，其他（含留空）一律當作關掉 */
  var CDN = String(cfg.imageCdn || "").trim().replace(/\/+$/, "");
  if(!/^https:\/\/[^\/?#]+$/.test(CDN)) CDN = "";
  var CDN_PRE = CDN ? CDN + "/" : "";
  var CDN_OFF_KEY = "arch-cdn-off";
  var CDN_MAX_FAILS = 2;
  var cdnFails = 0;
  var cdnOff = false;
  try{ cdnOff = window.sessionStorage.getItem(CDN_OFF_KEY) === "1"; }catch(e){}

  /* 路徑（或網址尾巴）→ 縮圖：最後一段的副檔名換成 -s.jpg；沒有副檔名就直接加 */
  function thumbPath(path){
    path = String(path || "");
    var slash = path.lastIndexOf("/");
    var name = path.slice(slash + 1);
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    return path.slice(0, slash + 1) + base + SUFFIX;
  }

  /* 網址尾巴（arch-images/ 後面那段，還是網址編碼）；不是正式版 arch-images 的網址 → null */
  function tailOf(url){
    var s = String(url || "");
    if(!PUB || s.indexOf(PUB) !== 0) return null;
    var tail = s.slice(PUB.length);
    if(!tail || /[?#]/.test(tail) || tail.charAt(tail.length - 1) === "/") return null;
    return tail;
  }

  function thumbUrl(url){
    var tail = tailOf(url);
    return tail ? PUB + thumbPath(tail) : url;
  }

  /* 顯示用網址：arch-images 公開網址 → CDN；其他（Google 頭像、外部圖、空值）原樣 */
  function cdnUrl(url){
    if(!CDN_PRE || cdnOff) return url;
    var tail = tailOf(url);
    return tail ? CDN_PRE + tail : url;
  }
  function isCdn(url){ return !!CDN_PRE && String(url || "").indexOf(CDN_PRE) === 0; }
  /* CDN 網址 → 原本的 Supabase 網址（不是 CDN 網址 → 原樣） */
  function originUrl(url){
    if(!isCdn(url) || !PUB) return url;
    return PUB + String(url).slice(CDN_PRE.length);
  }
  function turnCdnOff(){
    cdnOff = true;
    try{ window.sessionStorage.setItem(CDN_OFF_KEY, "1"); }catch(e){}
    if(window.console) console.warn("[Arch] 圖片 CDN 讀不到，這個分頁改從 Supabase 載入圖片");
  }

  function storagePath(url){
    var tail = tailOf(url);
    if(!tail) return null;
    try{ return decodeURIComponent(tail); }catch(e){ return null; }
  }

  function useThumb(img, url){
    var t = thumbUrl(url);
    if(t !== url) img.setAttribute("data-full", cdnUrl(url));
    else img.removeAttribute("data-full");
    img.src = cdnUrl(t);
    return img;
  }

  function useFull(img, url){
    img.removeAttribute("data-full");
    img.src = cdnUrl(url);
    return img;
  }

  function fullAttr(url){
    var t = thumbUrl(url);
    return { src: cdnUrl(t), full: t !== url ? cdnUrl(url) : "" };
  }

  /* 圖片載入失敗的退路（用「捕獲階段」在 document 先攔下來，這幾次的失敗不會傳到那張圖自己的 onerror）：
       1. 現在是 CDN 網址 → 改從 Supabase 載同一張（標記 data-cdn-retry，看 Supabase 讀不讀得到）
       2. 有 data-full（縮圖失敗）→ 拿掉 data-full、改載原圖（原圖如果是 CDN 網址，失敗時再走第 1 步）
     第 1 步換出來的一定不是 CDN 網址、第 2 步會拿掉 data-full，所以最多試 4 次（CDN 縮圖 → Supabase 縮圖 →
     CDN 原圖 → Supabase 原圖）就停，之後照那張圖自己的 onerror 處理（色塊、首字），不會無限循環 */
  document.addEventListener("error", function(e){
    var img = e.target;
    if(!img || img.tagName !== "IMG") return;
    var src = img.getAttribute("src") || "";
    if(isCdn(src)){
      var o = originUrl(src);
      if(o && o !== src){
        e.stopPropagation();
        img.setAttribute("data-cdn-retry", "1");
        img.src = o;
        return;
      }
    }
    img.removeAttribute("data-cdn-retry");
    var full = img.getAttribute("data-full");
    if(!full) return;
    img.removeAttribute("data-full");
    e.stopPropagation();
    img.src = cdnOff ? originUrl(full) : full;
  }, true);

  /* CDN 失敗、Supabase 卻讀得到 = CDN 那邊有問題（不是圖不存在）；累積 2 次就整個分頁停用 CDN */
  document.addEventListener("load", function(e){
    var img = e.target;
    if(!img || img.tagName !== "IMG" || !img.hasAttribute("data-cdn-retry")) return;
    img.removeAttribute("data-cdn-retry");
    if(!cdnOff && ++cdnFails >= CDN_MAX_FAILS) turnCdnOff();
  }, true);

  /* ---------- 瀏覽器縮圖 ---------- */
  function load(blob){
    return new Promise(function(resolve, reject){
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function(){ URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function(){
        URL.revokeObjectURL(url);
        reject(new Error("這張圖片讀不出來，請換一張（JPG、PNG 或 WebP）。"));
      };
      img.src = url;
    });
  }

  function toJpeg(img, maxSide, quality){
    return new Promise(function(resolve, reject){
      var w = img.naturalWidth, h = img.naturalHeight;
      var scale = Math.min(1, maxSide / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      var cv = document.createElement("canvas");
      cv.width = cw; cv.height = ch;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "white";   // 透明背景（PNG）轉 JPG 時填底色
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, cw, ch);
      cv.toBlob(function(b){
        if(!b){ reject(new Error("圖片處理失敗，請換一張試試。")); return; }
        resolve({ blob: b, w: cw, h: ch });
      }, "image/jpeg", quality);
    });
  }

  window.ArchImg = {
    url: cdnUrl, originUrl: originUrl,
    thumbUrl: thumbUrl, thumbPath: thumbPath, storagePath: storagePath,
    useThumb: useThumb, useFull: useFull, fullAttr: fullAttr,
    load: load, toJpeg: toJpeg
  };
})();
