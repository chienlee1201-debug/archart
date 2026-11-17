/* ============================================================
   config.js — Supabase 連線設定（正式版專案）
   這兩個值本來就是公開的，放在前端是正常做法；權限由 sql/01_foundation.sql 的 RLS 控管。
   絕對不要放進來的：Secret key（service_role）、資料庫密碼、Google 用戶端密鑰。

   imageCdn：圖片改從 Cloudflare 出去（省 Supabase 流量，見 md/Cloudflare節流.md）。
     出問題時改成 imageCdn: "" 就完全回到直接從 Supabase 載圖。
   ============================================================ */
window.ARCH_CONFIG = {
  supabaseUrl: "https://tbcoqejxkfoexdsyfptb.supabase.co",
  supabaseKey: "sb_publishable_ExvV39xjT_SaknqfkupObQ_nwc2-HWN",
  imageCdn: "https://img.archarttw.com"
};
