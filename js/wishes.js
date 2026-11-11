/* ============================================================
   wishes.js — 許願牆（wishes.html）
   需要先載入：config.js、supabase-js、db.js、auth.js、ui.js、cards.js

   · 列表：ArchDB.getWishes（public_wishes）。分頁「徵求提案中」／「已完成」（?status=closed）
       題材篩選在瀏覽器做（資料一次讀完），條件寫進網址 ?topic=寵物（replaceState，不增加上一頁紀錄）
       卡片只有文字（cards.js 的 ArchWish.wishCard），顯示提案數量
   · 許願對話框：「我要許願」有 data-login-reason（訪客先登入，回來自動打開）
       Email 預設帶入 Google 信箱；場合選「其他」要多填一格；Email、Instagram 至少一個
       送出 → ArchDB.createWish（sql/06_wishes.sql 的 arch_create_wish），願望＋聯絡方式一次寫入、狀態「待審核」
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards, W = window.ArchWish;
  if(!C || !W || !window.ArchDB || !window.ArchAuth) return;

  /* ============================================================
     列表
     ============================================================ */
  var params = new URLSearchParams(location.search);
  var status = params.get("status") === "closed" ? "closed" : "open";
  var grid = document.querySelector('[data-slot="wishes"]');
  var countEl = document.querySelector('[data-slot="count"]');
  var live = document.querySelector('[data-slot="live"]');
  var topicsEl = document.querySelector('[data-slot="topics"]');
  var wishes = [];

  Array.prototype.forEach.call(document.querySelectorAll("[data-seg]"), function(a){
    if(a.getAttribute("data-seg") === status) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
  if(status === "closed") document.title = "已完成・許願牆｜Arch";

  /* 網址上的題材不在選項裡就當沒選 */
  var topic = params.get("topic") || "";
  var topicInputs = Array.prototype.slice.call(topicsEl.querySelectorAll('input[name="topic"]'));
  if(!topicInputs.some(function(i){ return i.value === topic; })) topic = "";
  topicInputs.forEach(function(i){ i.checked = i.value === topic; });

  function render(){
    var list = topic ? wishes.filter(function(w){ return (w.tags || []).indexOf(topic) > -1; }) : wishes;
    countEl.textContent = String(list.length);
    grid.className = "grid grid--wishes";
    if(list.length){
      C.fill(grid, list.map(W.wishCard));
    }else{
      grid.className = "";
      var msg;
      if(topic){
        var clear = C.el("button", { class: "btn btn--ghost btn--sm", text: "看全部題材", attrs: { type: "button" } });
        clear.addEventListener("click", function(){ setTopic(""); });
        msg = C.emptyBox("沒有「" + topic + "」題材的願望。", clear);
      }else{
        msg = C.emptyBox(status === "closed" ? "還沒有已完成的願望。" : "目前還沒有徵求中的願望。你可以當第一個許願的人。");
      }
      C.fill(grid, msg);
    }
    live.textContent = "共 " + list.length + " 個願望";
  }

  function setTopic(t){
    topic = t;
    topicInputs.forEach(function(i){ i.checked = i.value === topic; });
    var u = new URL(location.href);
    if(topic) u.searchParams.set("topic", topic); else u.searchParams.delete("topic");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    render();
  }
  topicsEl.addEventListener("change", function(e){
    if(e.target.name === "topic") setTopic(e.target.value);
  });

  ArchDB.getWishes(status).then(function(rows){
    wishes = rows || [];
    topicsEl.disabled = false;
    render();
  }).catch(function(err){
    grid.className = "";
    C.fill(grid, C.errorBox(err));
    countEl.textContent = "–";
    live.textContent = "願望沒有順利載入";
  });

  /* ============================================================
     許願對話框
     ============================================================ */
  var dlg = document.getElementById("wish-dialog");
  var form = document.getElementById("wish-form");
  if(!dlg || !form) return;
  function byId(id){ return document.getElementById(id); }
  function slot(n){ return form.querySelector('[data-slot="' + n + '"]'); }
  var occ = byId("wish-occ"), occOtherField = byId("wish-occ-other-field");
  var email = byId("wish-email"), ig = byId("wish-ig");
  var statusEl = slot("wish-status");
  var submitBtn = form.querySelector('button[type="submit"]');
  var busy = false, prefilled = false;

  /* Email 預設帶入 Google 信箱（只帶一次；使用者清掉後不會再自動填回去） */
  function prefill(){
    var me = ArchAuth.me();
    if(prefilled || !me) return;
    prefilled = true;
    if(!email.value) email.value = me.email || "";
  }
  ArchAuth.ready.then(prefill);
  byId("new").addEventListener("click", function(){ setTimeout(prefill, 0); });

  occ.addEventListener("change", function(){
    occOtherField.hidden = occ.value !== "其他";
    if(!occOtherField.hidden) byId("wish-occ-other").focus();
  });

  /* 字數 */
  var intro = byId("wish-intro"), counter = form.querySelector('[data-counter="wish-intro"]');
  function updateCounter(){ counter.textContent = Array.from(intro.value).length + " / 500"; }
  intro.addEventListener("input", updateCounter);
  updateCounter();

  /* 題材最多 5 個 */
  var tagsField = byId("wish-tags-field");
  form.addEventListener("change", function(e){
    if(e.target.name !== "tags") return;
    var n = form.querySelectorAll('input[name="tags"]:checked').length;
    if(n > 5){ e.target.checked = false; tagsField.classList.add("is-invalid"); }
    else tagsField.classList.remove("is-invalid");
  });

  /* 一改就拿掉那一格的錯誤提示 */
  form.addEventListener("input", function(e){
    var f = e.target.closest(".field.is-invalid");
    if(f && f !== tagsField) f.classList.remove("is-invalid");
    if(e.target === email || e.target === ig) byId("wish-contact-field").classList.remove("is-invalid");
    statusEl.textContent = "";
  });

  function val(name){ var n = form.elements[name]; return n ? String(n.value || "").trim() : ""; }

  function validate(){
    var bad = [];
    function check(fieldId, ok){
      var f = byId(fieldId);
      f.classList.toggle("is-invalid", !ok);
      if(!ok) bad.push(f);
    }
    check("wish-story-field", !!val("story"));
    check("wish-occ-field", !!val("occasion"));
    check("wish-budget-field", !!val("budget_range"));
    if(val("occasion") === "其他") check("wish-occ-other-field", !!val("occasion_other"));
    else byId("wish-occ-other-field").classList.remove("is-invalid");
    check("wish-size-field", !!val("size"));

    var e = val("email"), i = val("instagram").replace(/^@/, "");
    var contactField = byId("wish-contact-field"), contactErr = byId("wish-contact-err");
    var contactMsg = "";
    if(!e && !i) contactMsg = "請留下 Email 或 Instagram，至少一個。";
    else if(e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) contactMsg = "Email 格式不正確，請再檢查一次。";
    else if(i && !/^[A-Za-z0-9._]{1,30}$/.test(i)) contactMsg = "Instagram 帳號只能有英文、數字、底線和點，最多 30 字。";
    contactErr.textContent = contactMsg;
    contactField.classList.toggle("is-invalid", !!contactMsg);
    if(contactMsg) bad.push(contactField);

    if(bad.length){
      var first = bad[0].querySelector(".ctrl");
      if(first) first.focus();
      bad[0].scrollIntoView({ block: "center" });
    }
    return !bad.length;
  }

  function data(){
    return {
      title: val("title"),
      story: val("story"),
      occasion: val("occasion"),
      occasion_other: val("occasion") === "其他" ? val("occasion_other") : "",
      budget_range: val("budget_range"),
      size: val("size"),
      tags: Array.prototype.map.call(form.querySelectorAll('input[name="tags"]:checked'), function(x){ return x.value; }),
      intro: val("intro"),
      show_name: (form.querySelector('input[name="show_name"]:checked') || {}).value === "true",
      email: val("email"),
      instagram: val("instagram").replace(/^@/, "")
    };
  }

  function showDone(done){
    slot("wish-fields").hidden = done;
    slot("wish-actions").hidden = done;
    slot("wish-done").hidden = !done;
    slot("wish-done-actions").hidden = !done;
  }

  form.addEventListener("submit", function(e){
    e.preventDefault();
    if(busy || !validate()) return;
    busy = true;
    submitBtn.disabled = true;
    statusEl.textContent = "送出中…";
    ArchDB.createWish(data()).then(function(){
      form.reset();
      prefilled = false;
      occOtherField.hidden = true;
      updateCounter();
      statusEl.textContent = "";
      showDone(true);
      var ok = slot("wish-done-actions").querySelector(".btn");
      if(ok) ok.focus();
    }).catch(function(err){
      statusEl.textContent = (err && err.message) || "沒有送出成功，請再試一次。";
    }).then(function(){
      busy = false;
      submitBtn.disabled = false;
    });
  });

  /* 關掉後再打開：回到空白表單 */
  dlg.addEventListener("close", function(){
    if(!slot("wish-done").hidden){ showDone(false); prefill(); }
  });
})();
