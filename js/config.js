/* ============================================================
   config.js — Supabase 連線設定（正式版專案）
   這兩個值本來就是公開的，放在前端是正常做法；權限由 sql/01_foundation.sql 的 RLS 控管。
   絕對不要放進來的：Secret key（service_role）、資料庫密碼、Google 用戶端密鑰。
   ============================================================ */
window.ARCH_CONFIG = {
  supabaseUrl: "https://tbcoqejxkfoexdsyfptb.supabase.co",
  supabaseKey: "sb_publishable_ExvV39xjT_SaknqfkupObQ_nwc2-HWN"
};
