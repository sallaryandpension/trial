/* The page that keeps the report link in front of the teacher. The sending page opens it once she says she saved the
   link, and tells it, in the same browser only, how the sending goes. */
(function (global) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const parsed = global.CaseCrypto.parseCode(global.location.hash);
  if (!parsed) {
    $("bad").hidden = false;
    return;
  }
  const link = new URL(`report.html#${parsed.caseId}.${parsed.reportKey}`, global.location.href).href;
  $("link").textContent = link;
  $("open").href = link;
  global.QrDraw.draw($("qr"), link);
  $("keep").hidden = false;

  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(link); $("copied").textContent = "הקישור הועתק."; } catch (e) { $("copied").textContent = "ההעתקה לא הצליחה. אפשר לסמן את הקישור ולהעתיק."; }
  });

  /* News from the sending tab, about this case only. Nothing leaves the browser. */
  const STATES = {
    sending: (m) => `הקבצים נשלחים בלשונית "שליחת התלוש" (חלק ${m.part} מתוך ${m.parts}). לא לסגור אותה עד שהשליחה מסתיימת.`,
    done: () => "הקבצים נשלחו. הדוח יהיה מוכן בתוך כמה ימים, בקישור שבדף הזה. את לשונית השליחה אפשר לסגור. את הדף הזה כדאי לשמור.",
    failed: () => "השליחה לא הושלמה. חזרי ללשונית \"שליחת התלוש\" ולחצי \"נסי שוב\".",
  };
  /* Reached from the sending page itself, after the files went out. */
  if (new URLSearchParams(global.location.search).get("sent") === "1") $("send-state").textContent = STATES.done();
  if (global.BroadcastChannel) {
    const channel = new global.BroadcastChannel("send-status");
    channel.onmessage = (e) => {
      const m = e.data || {};
      if (m.caseId !== parsed.caseId || !STATES[m.state]) return;
      $("send-state").textContent = STATES[m.state](m);
    };
  }

  /* Closing it by mistake asks first. */
  global.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; });
})(window);
