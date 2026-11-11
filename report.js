/* Fetches the encrypted report by case number and opens it here. Only the case number leaves the browser. */
(function (global) {
  "use strict";
  const C = global.CaseCrypto;
  const $ = (id) => document.getElementById(id);

  function say(text, error) {
    $("status").textContent = text;
    $("status").classList.toggle("error", !!error);
  }

  async function fetchReport(code) {
    $("again").hidden = true;
    say("בודקים...");
    let reply;
    try {
      reply = await global.Api.call("getReport", { caseId: code.caseId });
    } catch (e) {
      say("אין חיבור לשרת. נסי שוב מאוחר יותר.", true);
      $("again").hidden = false;
      return;
    }
    if (!reply.ok) {
      say(reply.error === "busy" ? "יש עומס. נסי שוב בעוד כמה דקות." : "הקישור לא תקין.", true);
      $("again").hidden = reply.error !== "busy";
      return;
    }
    if (!reply.ready) {
      say("הדוח עוד לא מוכן. נסי שוב בעוד כמה ימים.");
      $("again").hidden = false;
      return;
    }
    try {
      const pdf = await C.openReport(C.fromBase64(reply.data), code.caseId, code.reportKey);
      const save = $("save");
      save.href = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
      save.download = "דוח_בדיקת_תלוש.pdf";
      save.hidden = false;
      $("scope").hidden = false;
      $("erase").href = `delete.html#${code.caseId}.${code.reportKey}`;  // The key stays after the #, in this browser.
      $("erase-note").hidden = false;
      $("resubmit-box").hidden = !reply.resubmit;   // only under an error report
      opened = code;
      $("ask").hidden = true;
      say("הדוח מוכן.");
    } catch (e) {
      say("הקובץ לא נפתח. בדקי שהעתקת את כל הקישור.", true);
    }
  }

  function fromPaste() {
    const code = C.parseCode($("code").value);
    if (!code) { say("הקישור לא שלם. העתיקי אותו שוב, מההתחלה ועד הסוף.", true); return; }
    fetchReport(code);
  }

  /* Upload again into this case, after an error report: the case and its key wait in this tab only, the entry page
     takes the code from the error report, and the sending page uses this case instead of making a new one. */
  let opened = null;
  $("resubmit").addEventListener("click", () => {
    if (!opened) return;
    try { global.sessionStorage.setItem("resubmit", `${opened.caseId}.${opened.reportKey}`); } catch (e) { return; }
    global.location.href = "index.html?resubmit=1";
  });

  const current = C.parseCode(global.location.hash);
  $("open").addEventListener("click", fromPaste);
  $("again").addEventListener("click", () => fetchReport(current || C.parseCode($("code").value)));
  if (current) fetchReport(current);
  else $("ask").hidden = false;
})(window);
