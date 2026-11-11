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

   用法：
     ArchImg.thumbUrl(url)          縮圖網址（不是 arch-images 的網址 → 原樣回傳）
     ArchImg.thumbPath(path)        Storage 路徑 → 縮圖路徑（db.js 上傳縮圖用）
     ArchImg.storagePath(url)       arch-images 公開網址 → Storage 路徑（不是 → null）
     ArchImg.useThumb(img, url)     <img> 顯示縮圖、失敗退回原圖
     ArchImg.fullAttr(url)          拼 HTML 字串用：回傳 { src, full }（full 空字串 = 不用退回）
     ArchImg.load(blob)             Blob／File → 讀好的 <img>（Promise）
     ArchImg.toJpeg(img, 長邊上限, 品質)  → Promise { blob, w, h }（只縮小不放大，透明處填白底）
   ============================================================ */
(function(){
  "use strict";

  var cfg = window.ARCH_CONFIG || {};
  var BASE = String(cfg.supabaseUrl || "").replace(/\/+$/, "");
  var PUB = BASE ? BASE + "/storage/v1/object/public/arch-images/" : "";
  var SUFFIX = "-s.jpg";

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

  function storagePath(url){
    var tail = tailOf(url);
    if(!tail) return null;
    try{ return decodeURIComponent(tail); }catch(e){ return null; }
  }

  function useThumb(img, url){
    var t = thumbUrl(url);
    if(t !== url) img.setAttribute("data-full", url);
    else img.removeAttribute("data-full");
    img.src = t;
    return img;
  }

  function fullAttr(url){
    var t = thumbUrl(url);
    return { src: t, full: t !== url ? url : "" };
  }

  /* 縮圖載入失敗 → 改載原圖一次。
     用「捕獲階段」在 document 先攔下來，這一次的失敗不會傳到那張圖自己的 onerror；
     data-full 拿掉之後，原圖再失敗就照原本的 onerror 處理 */
  document.addEventListener("error", function(e){
    var img = e.target;
    if(!img || img.tagName !== "IMG") return;
    var full = img.getAttribute("data-full");
    if(!full) return;
    img.removeAttribute("data-full");
    e.stopPropagation();
    img.src = full;
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
    thumbUrl: thumbUrl, thumbPath: thumbPath, storagePath: storagePath,
    useThumb: useThumb, fullAttr: fullAttr,
    load: load, toJpeg: toJpeg
  };
})();
