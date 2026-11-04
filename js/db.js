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
      if(!/[一-鿿]/.test(msg)) msg = "系統忙碌中，請稍後再試一次。";
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

  window.ArchDB = {
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
    }
  };
})();
