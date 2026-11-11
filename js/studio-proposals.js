/* ============================================================
   studio-proposals.js — 畫家後台「許願提案」（studio.html#proposals）
   需要先載入：db.js、auth.js、cards.js（studio.js 之後載入）

   · 列出我提過的所有提案：ArchDB.myProposals（sql/06_wishes.sql 的 arch_my_proposals），新的在前
       每筆：願望摘要（連回願望頁）、我的提案內容、時間
   · 被許願者選中的那幾筆：多一塊「許願者選了你的提案」＋對方的 Email／Instagram，提醒只用來討論這個願望
     沒被選中的不顯示任何標示
   · 被管理者隱藏的提案：註明不會公開顯示
   · 管理者用 studio.html?artist=… 編輯別人時，這裡不顯示（提案請到管理後台「提案」看）
   ============================================================ */
(function(){
  "use strict";
  var C = window.ArchCards, W = window.ArchWish;
  if(!C || !W || !window.ArchDB || !window.ArchAuth) return;
  var el = C.el;
  var box = document.querySelector('[data-slot="my-proposals"]');
  if(!box) return;

  function contactBlock(p){
    var c = p.contact || {}, rows = [];
    if(c.email){
      rows.push(el("div", {}, [el("dt", { text: "Email" }), el("dd", {}, [
        el("a", { href: "mailto:" + c.email + "?subject=" + encodeURIComponent("[Arch 許願牆] 關於「" + W.wishTitle(p.wish) + "」"), text: c.email })
      ])]));
    }
    if(c.instagram){
      rows.push(el("div", {}, [el("dt", { text: "Instagram" }), el("dd", {}, [
        el("a", { href: "https://www.instagram.com/" + encodeURIComponent(c.instagram) + "/", text: "@" + c.instagram,
          attrs: { target: "_blank", rel: "noopener noreferrer", "aria-label": "到 Instagram 看 @" + c.instagram + "（另開視窗）" } })
      ])]));
    }
    return el("div", { class: "notice notice--ok my-prop-picked" }, [
      el("div", {}, [
        el("strong", { text: "許願者選了你的提案" }),
        rows.length ? el("dl", { class: "wish-private-list" }, rows) : el("p", { text: "許願者沒有留聯絡方式。" }),
        el("p", { class: "small", text: "這些聯絡方式只用來討論這個願望，請不要另作他用。" })
      ])
    ]);
  }

  function item(p){
    var w = p.wish || {};
    var meta = [W.occasionText(w), W.budgetText(w.budget_range), w.size ? "尺寸 " + w.size : ""].filter(Boolean).join("・");
    return el("article", { class: "my-prop" }, [
      el("div", { class: "my-prop-head" }, [
        el("div", { class: "row-main" }, [
          el("h3", {}, [el("a", { href: W.wishHref(w), text: W.wishTitle(w) })]),
          meta ? el("p", { text: meta }) : null
        ]),
        W.statusBadge(w.status)
      ]),
      el("p", { class: "quote my-prop-wish", text: "「" + String(w.story || "").trim() + "」" }),
      el("div", { class: "my-prop-mine" }, [
        el("p", { class: "my-prop-label" }, ["我的提案・", W.timeEl(p.created_at, "")]),
        el("p", { class: "my-prop-msg", text: p.message })
      ]),
      p.status === "hidden" ? el("p", { class: "notice notice--warn", text: "這則提案已被管理者隱藏，不會公開顯示。有問題可以寫信到 archarttw@gmail.com。" }) : null,
      p.selected ? contactBlock(p) : null
    ]);
  }

  ArchAuth.requirePage().then(function(me){
    if(!me) return;
    var target = new URLSearchParams(location.search).get("artist");
    if(target && me.is_admin && !(me.artist && me.artist.id === target)){
      C.fill(box, C.emptyBox("管理者模式不顯示這位畫家的提案，請到管理後台的「提案」查看。"));
      return;
    }
    if(!me.artist) return;                           // studio.js 會導向申請頁
    ArchDB.myProposals().then(function(list){
      list = list || [];
      if(!list.length){
        C.fill(box, C.emptyBox(me.artist.status === "approved"
          ? "你還沒有提案。在許願牆找到想畫的畫面，寫下你想怎麼畫就可以提案。"
          : "畫家頁通過審核、上架之後，就能在許願牆對願望提案。"));
        return;
      }
      C.fill(box, el("div", { class: "my-props" }, list.map(item)));
    }).catch(function(err){
      C.fill(box, C.errorBox(err));
    });
  });
})();
