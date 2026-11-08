/* Creates the report link, encrypts each part and sends it. The link is created here and is never sent in the clear:
   the report key travels only inside the encrypted parts. */
(function (global) {
  "use strict";
  const C = global.CaseCrypto;
  const $ = (id) => document.getElementById(id);
  const TRIES = 3;
  const RETRY_WAIT = 1500;

  let blobs = [];
  let session = null;  // { caseId, reportKey, link }
  let uploadToken = null;
  let nextPart = 1;

  function reportLink(id, key) {
    return new URL(`report.html#${id}.${key}`, global.location.href).href;
  }

  function showMissing(title, text, label, href) {
    $("missing-title").textContent = title;
    $("missing-text").textContent = text;
    $("missing-link").textContent = label;
    $("missing-link").href = href;
    $("missing").hidden = false;
  }

  function showLink() {
    const { link } = session;
    const subject = "קישור לדוח בדיקת התלוש";
    const body = `הדוח יהיה זמין בקישור הזה:\n${link}`;
    $("link").textContent = link;
    $("by-mail").href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    $("by-sms").href = `sms:?&body=${encodeURIComponent(body)}`;
    $("share").hidden = !navigator.share;
    global.QrDraw.draw($("qr"), link);
    $("step-code").hidden = false;
    $("step-send").hidden = false;
  }

  function saveAsText() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([session.link + "\n"], { type: "text/plain" }));
    a.download = "קישור_לדוח.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* Network errors and server errors are retried. Answers that mean "no" are not. */
  async function attempt(action, fields) {
    let last = "network";
    for (let i = 0; i < TRIES; i++) {
      if (i) await wait(RETRY_WAIT * i);
      try {
        const reply = await global.Api.call(action, fields);
        if (reply.ok) return reply;
        last = reply.error;
        if (last !== "server" && last !== "busy") break;
      } catch (e) {
        last = "network";
      }
    }
    throw new Error(last);
  }

  async function sendPart(number) {
    const pdf = new Uint8Array(await blobs[number - 1].arrayBuffer());
    const sealed = await C.sealPart({
      pdf, caseId: session.caseId, reportKey: session.reportKey, part: number, parts: blobs.length, publicKey: global.SITE.publicKey,
    });
    return attempt("uploadPart", { uploadToken, part: number, data: C.toBase64(sealed) });
  }

  function say(text, error) {
    $("status").textContent = text;
    $("status").classList.toggle("error", !!error);
  }

  const FAILURES = {
    ticket: "אישור הכניסה כבר נוצל או שפג תוקפו. צריך קוד כניסה חדש. בקשי אותו מחדש בטופס הרישום.",
    upload: "השליחה נקטעה זמן רב מדי. צריך להתחיל מחדש מעמוד הריקון.",
  };

  async function run() {
    $("send").disabled = true;
    $("retry").hidden = true;
    $("back").hidden = true; // Leaving mid-send would cut the upload. A failure brings it back below.
    $("saved").disabled = true;
    $("progress").hidden = false;
    $("progress").max = blobs.length;
    try {
      if (!uploadToken) {
        const ticket = global.sessionStorage.getItem("ticket") || "";
        const begun = await attempt("beginUpload", { ticket, caseId: session.caseId, parts: blobs.length });
        uploadToken = begun.uploadToken;
        global.sessionStorage.removeItem("ticket");
      }
      for (; nextPart <= blobs.length; nextPart++) {
        say(`מצפינים ושולחים חלק ${nextPart} מתוך ${blobs.length}. זה עשוי לקחת כמה דקות. לא לסגור את הלשונית ולא לעבור עמוד.`);
        $("progress").value = nextPart - 1;
        await sendPart(nextPart);
      }
      $("progress").value = blobs.length;
      blobs = [];
      $("step-code").hidden = true;
      $("step-send").hidden = true;
      $("done").hidden = false;
    } catch (e) {
      const known = FAILURES[e.message];
      say(known || "השליחה לא הושלמה. החלקים שכבר נשלחו נשמרו, ואפשר לנסות שוב.", true);
      $("retry").hidden = !!known;
      $("back").hidden = false;
    }
  }

  async function start() {
    if (!global.sessionStorage.getItem("ticket")) {
      showMissing("צריך להיכנס קודם", "כדי לשלוח צריך קוד כניסה.", "לכניסה", "index.html");
      return;
    }
    blobs = await global.Handoff.take();
    if (!blobs.length) {
      showMissing("אין קובץ לשליחה", "הקובץ נמחק מהדפדפן כשעזבת את העמוד, או שעדיין לא נוצר. צריך ליצור אותו בעמוד הריקון.", "לעמוד הריקון", "blank.html");
      return;
    }
    const made = C.makeCase();
    session = Object.assign(made, { link: reportLink(made.caseId, made.reportKey) });
    const megabytes = blobs.reduce((sum, b) => sum + b.size, 0) / (1024 * 1024);
    const parts = blobs.length === 1 ? "" : `, ב-${blobs.length} חלקים`;
    $("summary").textContent = `הקובץ מוכן: ${megabytes.toFixed(1)}MB${parts}. הוא יוצפן לפני שהוא יוצא מהמחשב.`;
    showLink();
  }

  $("saved").addEventListener("change", () => { $("send").disabled = !$("saved").checked; });
  $("send").addEventListener("click", run);
  $("retry").addEventListener("click", run);
  $("download").addEventListener("click", saveAsText);
  $("copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(session.link);
    $("copied").textContent = "הקישור הועתק.";
  });
  $("share").addEventListener("click", () => navigator.share({ title: "קישור לדוח", url: session.link }).catch(() => {}));
  global.addEventListener("beforeunload", (e) => { if (blobs.length && !$("step-send").hidden) e.preventDefault(); });

  start().catch(() => showMissing("משהו השתבש", "לא הצלחנו לקרוא את הקובץ מהדפדפן.", "לעמוד הריקון", "blank.html"));
})(window);
