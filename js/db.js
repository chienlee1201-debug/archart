/* ============================================================
   db.js — 資料存取（所有讀寫資料庫的地方都集中在這裡）
   連線物件由 auth.js 建立（ArchAuth.client），這裡在呼叫當下才去拿，所以可以比 auth.js 早載入。
   錯誤一律轉成中文 Error 丟出，頁面直接顯示 err.message 即可。
   ============================================================ */
(function(){
  "use strict";

  function client(){
    var c = window.ArchAuth && window.ArchAuth.client;
    if(!c) throw new Error("暫時連不上 Arch，請檢查網路後重新整理頁面。");
    return c;
  }

  /* Supabase 回傳 { data, error }：有錯就丟出中文訊息 */
  function unwrap(res){
    if(res.error){
      var msg = res.error.message || "";
      // 資料庫自己寫的錯誤訊息是中文，直接用；其他情況給一般說法
      if(/fetch|network|load failed/i.test(msg)) msg = "連不上 Arch，請檢查網路後重新整理。";
      else if(!/[一-鿿]/.test(msg)) msg = "系統忙碌中，請稍後再試一次。";
      var err = new Error(msg);
      err.cause = res.error;
      throw err;
    }
    return res.data;
  }

  function run(fn){
    try{ return Promise.resolve(fn()).then(unwrap); }
    catch(e){ return Promise.reject(e); }
  }

  /* ---------- 公開資料（訪客也能讀；走 public_artists／public_works 檢視表，只含已上架畫家） ---------- */
  var ARTIST_COLS_BASE = "id, slug, name, tags, tagline, story, portrait_url, email, instagram, custom_ok, custom_note, sort_order, created_at";
  var ARTIST_COLS = ARTIST_COLS_BASE + ", location";   // location（我的位置）：sql/05_slug_location.sql 加的
  var hasLocation = true;
  var WORK_COLS = "id, artist_id, position, title, image_url, medium, support, width_cm, height_cm, price_min, price_max, status, year, description, created_at";
  /* 許願牆（sql/06_wishes.sql 的 public_wishes／public_proposals） */
  var WISH_COLS = "id, title, story, tags, occasion, occasion_other, budget_range, size, intro, status, created_at, author_name, proposal_count";
  var PROPOSAL_COLS = "id, wish_id, artist_id, message, created_at, artist_name, artist_slug, artist_portrait";
  var UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  function byArtistOrder(a, b){
    return (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at));
  }
  function byPosition(a, b){ return (a.position || 0) - (b.position || 0); }

  /* 把作品掛到畫家底下：artist.works（依 position）、work.artist */
  function join(artists, works){
    var map = {};
    artists.forEach(function(a){ a.works = []; map[a.id] = a; });
    var kept = [];
    works.forEach(function(w){
      var a = map[w.artist_id];
      if(!a) return;
      w.artist = a;
      a.works.push(w);
      kept.push(w);
    });
    artists.forEach(function(a){ a.works.sort(byPosition); });
    return kept;
  }

  /* Storage 上傳錯誤 → 中文說明 */
  function uploadMsg(error){
    var raw = String(error.message || "") + " " + String(error.statusCode || error.status || "");
    if(/too large|exceeded|413/i.test(raw)) return "圖片太大了（最多 5MB），請換一張小一點的。";
    if(/mime|type/i.test(raw)) return "只能上傳 JPG、PNG 或 WebP 圖片。";
    if(/row-level|security|unauthor|403|401/i.test(raw)) return "沒有權限上傳，請重新整理頁面或重新登入。";
    if(/fetch|network|load failed/i.test(raw)) return "連不上 Arch，請檢查網路後再試一次。";
    return "圖片上傳失敗，請再試一次。";
  }

  /* 讀 public_artists：資料庫還沒跑 sql/05（沒有 location 欄位）時，自動改用不含 location 的欄位再讀一次 */
  function selectArtists(build){
    return run(function(){ return build(hasLocation ? ARTIST_COLS : ARTIST_COLS_BASE); }).catch(function(err){
      var c = err && err.cause;
      if(hasLocation && c && (c.code === "42703" || /location/.test(String(c.message || "")))){
        hasLocation = false;
        return run(function(){ return build(ARTIST_COLS_BASE); });
      }
      throw err;
    });
  }

  var catalogPromise = null;

  window.ArchDB = {
    /* 全部已上架畫家＋作品（資料量小，一次讀完；同一頁重複呼叫只讀一次）
       回傳 { artists, works }：
         artists 依 sort_order → created_at 排序，每位帶 works（依 position）
         works   依畫家順序 → position 排序，每件帶 artist */
    getCatalog: function(){
      if(catalogPromise) return catalogPromise;
      catalogPromise = Promise.all([
        selectArtists(function(cols){ return client().from("public_artists").select(cols).order("sort_order").order("created_at"); }),
        run(function(){ return client().from("public_works").select(WORK_COLS).order("position"); })
      ]).then(function(r){
        var artists = (r[0] || []).slice().sort(byArtistOrder);
        join(artists, r[1] || []);
        var works = [];
        artists.forEach(function(a){ works = works.concat(a.works); });
        return { artists: artists, works: works };
      });
      catalogPromise.catch(function(){ catalogPromise = null; });   // 失敗時下次重讀
      return catalogPromise;
    },

    /* 首頁精選畫家的 id（依順序，最多 6 位；sql/03_featured.sql）。沒有設定 → 空陣列 */
    getFeatured: function(){
      return run(function(){
        return client().from("public_featured_artists").select("artist_id, position").order("position");
      }).then(function(rows){
        return (rows || []).map(function(r){ return r.artist_id; });
      });
    },

    /* 一位已上架畫家（含作品）；slug 不對或沒有上架 → null */
    getArtist: function(slug){
      slug = String(slug || "").trim().toLowerCase();
      if(!SLUG_RE.test(slug)) return Promise.resolve(null);
      return selectArtists(function(cols){
        return client().from("public_artists").select(cols).eq("slug", slug).maybeSingle();
      }).then(function(a){
        if(!a) return null;
        return run(function(){
          return client().from("public_works").select(WORK_COLS).eq("artist_id", a.id).order("position");
        }).then(function(works){ join([a], works || []); return a; });
      });
    },

    /* 一件作品（含所屬畫家與畫家的全部作品）；id 不對或畫家沒有上架 → null */
    getWork: function(id){
      id = String(id || "").trim();
      if(!UUID_RE.test(id)) return Promise.resolve(null);
      return run(function(){
        return client().from("public_works").select(WORK_COLS).eq("id", id).maybeSingle();
      }).then(function(w){
        if(!w) return null;
        return Promise.all([
          selectArtists(function(cols){ return client().from("public_artists").select(cols).eq("id", w.artist_id).maybeSingle(); }),
          run(function(){ return client().from("public_works").select(WORK_COLS).eq("artist_id", w.artist_id).order("position"); })
        ]).then(function(r){
          var a = r[0];
          if(!a) return null;
          join([a], r[1] || []);
          return a.works.filter(function(x){ return x.id === w.id; })[0] || null;
        });
      });
    },

    /* 我是誰：{ id, display_name, avatar_url, email, is_admin, artist:{id,slug,status,name}|null }，訪客回傳 null */
    getMe: function(){
      return run(function(){ return client().rpc("arch_me"); });
    },

    /* 修改自己的個人資料（目前只開放顯示名稱） */
    updateProfile: function(userId, fields){
      var patch = {};
      if("display_name" in fields) patch.display_name = fields.display_name;
      return run(function(){
        return client().from("profiles").update(patch).eq("id", userId).select("id, display_name, avatar_url").single();
      });
    },

    /* ---------- 畫家後台（sql/02_artists.sql 的函式；寫入一律走函式，前台不能直接改 artists／works） ---------- */

    /* 申請成為畫家：建立自己的草稿畫家頁（已經有就回傳原本那個），回傳畫家 id。referral：threads／instagram／friend／other／空 */
    startArtist: function(referral){
      return run(function(){ return client().rpc("arch_start_artist", { p_referral: referral || null }); });
    },

    /* 讀取畫家後台資料。artistId 空 = 我自己的（沒有畫家頁回傳 null）；管理者可以指定任何畫家
       回傳 { artist, works, revision, mode: admin|revision|direct, is_owner, owner } */
    studioLoad: function(artistId){
      return run(function(){ return client().rpc("arch_studio_load", { p_artist: artistId || null }); });
    },

    /* 儲存畫家資料＋作品（整份）。submit = true 是「送出審核」；回傳最新的後台資料 */
    saveArtist: function(artistId, data, submit){
      return run(function(){
        return client().rpc("arch_save_artist", { p_artist: artistId || null, p: data, p_submit: !!submit });
      });
    },

    /* 已上架畫家：放棄還沒結案的修改 */
    discardRevision: function(artistId){
      return run(function(){ return client().rpc("arch_discard_revision", { p_artist: artistId || null }); });
    },

    /* 上傳圖片到 Storage（bucket arch-images，路徑「畫家 id/檔名」），回傳大圖的公開網址
       thumbBlob（可省略）：同時上傳縮圖，路徑照 images.js 的規則（大圖路徑去副檔名＋-s.jpg）。
       縮圖失敗不擋上傳（顯示時會自動退回大圖），只記在 console */
    uploadImage: function(artistId, blob, ext, thumbBlob){
      var path = artistId + "/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
      var bucket;
      try{ bucket = client().storage.from("arch-images"); }
      catch(e){ return Promise.reject(e); }
      return bucket.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false })
        .then(function(res){
          if(res.error){ var err = new Error(uploadMsg(res.error)); err.cause = res.error; throw err; }
          var url = bucket.getPublicUrl(path).data.publicUrl;
          if(!thumbBlob) return url;
          if(!window.ArchImg){ console.warn("[Arch] 沒有載入 images.js，縮圖沒有上傳：" + path); return url; }
          var tPath = window.ArchImg.thumbPath(path);
          return bucket.upload(tPath, thumbBlob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false })
            .then(function(r2){
              if(r2.error) console.warn("[Arch] 縮圖上傳失敗（會改用大圖顯示）：" + tPath, r2.error);
              return url;
            }, function(e){
              console.warn("[Arch] 縮圖上傳失敗（會改用大圖顯示）：" + tPath, e);
              return url;
            });
        }, function(e){
          var err = new Error("連不上 Arch，請檢查網路後再試一次。"); err.cause = e; throw err;
        });
    },

    /* ---------- 補產生縮圖（管理後台；sql/04_thumbs.sql 讓管理者可以上傳到任何路徑） ---------- */

    /* 列出 Storage 某個資料夾裡的檔名（不含子資料夾），回傳檔名陣列 */
    listImages: function(folder){
      var bucket;
      try{ bucket = client().storage.from("arch-images"); }
      catch(e){ return Promise.reject(e); }
      var names = [], PAGE = 1000;
      function page(offset){
        return bucket.list(folder, { limit: PAGE, offset: offset }).then(function(res){
          if(res.error){ var err = new Error("讀不到資料夾 " + folder + " 的檔案清單。"); err.cause = res.error; throw err; }
          (res.data || []).forEach(function(f){ if(f.id) names.push(f.name); });   // 沒有 id 的是子資料夾
          return (res.data || []).length === PAGE ? page(offset + PAGE) : names;
        });
      }
      return page(0);
    },

    /* 上傳一張縮圖到指定路徑（不覆蓋）。回傳 "ok"；已經有了回傳 "exists"
       沒有權限時丟出 err.code = "denied"（多半是還沒執行 sql/04_thumbs.sql） */
    uploadThumb: function(path, blob){
      var bucket;
      try{ bucket = client().storage.from("arch-images"); }
      catch(e){ return Promise.reject(e); }
      return bucket.upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false })
        .then(function(res){
          if(!res.error) return "ok";
          var raw = String(res.error.message || "") + " " + String(res.error.statusCode || res.error.status || "") + " " + String(res.error.error || "");
          if(/already exists|duplicate|409/i.test(raw)) return "exists";
          var err = new Error(uploadMsg(res.error)); err.cause = res.error;
          if(/row-level|security|unauthor|403|401/i.test(raw)) err.code = "denied";
          throw err;
        }, function(e){
          var err = new Error("連不上 Arch，請檢查網路後再試一次。"); err.cause = e; throw err;
        });
    },

    /* ---------- 認領（claim.html） ---------- */

    /* 認領連結預覽（訪客也能用）：{ name, portrait_url, works:[{title,image_url}] }；連結失效回傳 null */
    claimPreview: function(token){
      return run(function(){ return client().rpc("arch_claim_preview", { p_token: String(token || "") }); });
    },

    /* 認領（要登入）：{ result: ok|invalid|has_artist, artist_id } */
    claimArtist: function(token){
      return run(function(){ return client().rpc("arch_claim_artist", { p_token: String(token || "") }); });
    },

    /* ---------- 許願牆（sql/06_wishes.sql；寫入一律走函式，前台不能直接改 wishes／proposals） ---------- */

    /* 公開的願望：status = "open"（徵求提案中）或 "closed"（已結束），新的在前 */
    getWishes: function(status){
      return run(function(){
        return client().from("public_wishes").select(WISH_COLS).eq("status", status === "closed" ? "closed" : "open").order("created_at", { ascending: false });
      });
    },

    /* 一個公開的願望＋公開中的提案（舊的在前）；id 不對、還沒公開 → wish 為 null（許願者本人另外用 wishMe 讀） */
    getWish: function(id){
      id = String(id || "").trim();
      if(!UUID_RE.test(id)) return Promise.resolve({ wish: null, proposals: [] });
      return Promise.all([
        run(function(){ return client().from("public_wishes").select(WISH_COLS).eq("id", id).maybeSingle(); }),
        run(function(){ return client().from("public_proposals").select(PROPOSAL_COLS).eq("wish_id", id).order("created_at"); })
      ]).then(function(r){ return { wish: r[0] || null, proposals: r[1] || [] }; });
    },

    /* 願望頁上「我」的資料（要登入）：{ owner, wish, contact, selected:[提案 id], my_proposal } */
    wishMe: function(id){
      return run(function(){ return client().rpc("arch_wish_me", { p_wish: id }); });
    },

    /* 許願：data = { title, story, occasion, occasion_other, budget_range, size, tags, intro, show_name, email, instagram }，回傳願望 id */
    createWish: function(data){
      return run(function(){ return client().rpc("arch_create_wish", { p: data }); });
    },

    /* 我的許願（我的帳號）：全部狀態，含審核備註、提案數 */
    myWishes: function(){
      return run(function(){ return client().rpc("arch_my_wishes"); });
    },

    /* 許願者選擇提案（不能取消），回傳 { id, artist_name } */
    selectProposal: function(proposalId){
      return run(function(){ return client().rpc("arch_select_proposal", { p_proposal: proposalId }); });
    },

    /* 許願者結束徵求 */
    closeWish: function(id){
      return run(function(){ return client().rpc("arch_close_wish", { p_wish: id }); });
    },

    /* 畫家提案：新增或修改自己的提案，回傳 { id, message, status, selected, created_at } */
    saveProposal: function(wishId, message){
      return run(function(){ return client().rpc("arch_save_proposal", { p_wish: wishId, p_message: message }); });
    },

    /* 畫家刪除自己的提案 */
    deleteProposal: function(proposalId){
      return run(function(){ return client().rpc("arch_delete_proposal", { p_proposal: proposalId }); });
    },

    /* 我提過的提案（畫家後台）；被選中的附上許願者聯絡方式 contact */
    myProposals: function(){
      return run(function(){ return client().rpc("arch_my_proposals"); });
    },

    /* ---------- 管理後台（函式裡會再檢查是不是管理者） ---------- */

    adminWishes: function(){
      return run(function(){ return client().rpc("arch_admin_wishes"); });
    },
    /* 審核願望：approve true 公開／false 不通過（note 必填，許願者看得到） */
    adminReviewWish: function(wishId, approve, note){
      return run(function(){ return client().rpc("arch_admin_review_wish", { p_wish: wishId, p_approve: !!approve, p_note: note || null }); });
    },
    adminProposals: function(){
      return run(function(){ return client().rpc("arch_admin_proposals"); });
    },
    /* 隱藏（hidden = true）／取消隱藏提案 */
    adminHideProposal: function(proposalId, hidden){
      return run(function(){ return client().rpc("arch_admin_hide_proposal", { p_proposal: proposalId, p_hidden: !!hidden }); });
    },

    adminArtists: function(){
      return run(function(){ return client().rpc("arch_admin_artists"); });
    },
    /* 審核新申請：approve true 核准上架／false 退回修改（note 必填） */
    adminReviewArtist: function(artistId, approve, note){
      return run(function(){ return client().rpc("arch_admin_review_artist", { p_artist: artistId, p_approve: !!approve, p_note: note || null }); });
    },
    /* 審核已上架畫家的修改 */
    adminReviewRevision: function(revisionId, approve, note){
      return run(function(){ return client().rpc("arch_admin_review_revision", { p_revision: revisionId, p_approve: !!approve, p_note: note || null }); });
    },
    /* 重新產生認領連結，回傳新的認領碼 */
    adminNewClaimToken: function(artistId){
      return run(function(){ return client().rpc("arch_admin_new_claim_token", { p_artist: artistId }); });
    },
    /* 手動綁定帳號：{ result: ok|conflict, other }；replaceId = 確認要刪掉的那個畫家頁 id */
    adminBindArtist: function(artistId, email, replaceId){
      return run(function(){ return client().rpc("arch_admin_bind_artist", { p_artist: artistId, p_email: email, p_replace: replaceId || null }); });
    },
    /* 存首頁精選名單：ids 依首頁順序（最多 6 位，空陣列 = 清除、首頁改回自動），回傳存好的 id 陣列 */
    adminSetFeatured: function(ids){
      return run(function(){ return client().rpc("arch_admin_set_featured", { p_artists: ids || [] }); });
    }
  };
})();
