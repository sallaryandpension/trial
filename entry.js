/* Entry with a one-time code. Only the hash of the code leaves the browser. */
(function (global) {
  "use strict";
  const $ = (id) => document.getElementById(id);

  /* A code is ten characters. The dash, spaces and lower case are forgiven. */
  const normalize = (text) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

  function say(text, error) {
    $("status").textContent = text;
    $("status").classList.toggle("error", !!error);
  }

  async function enter() {
    const code = normalize($("code").value);
    if (code.length !== 10) { say("הקוד לא תקין.", true); return; }
    $("enter").disabled = true;
    say("בודקים...");
    try {
      const reply = await global.Api.call("checkCode", { hash: await global.CaseCrypto.sha256Hex(code) });
      if (reply.ok) {
        global.sessionStorage.setItem("ticket", reply.ticket);
        /* She may have prepared the file first: then it waits in the browser and she goes straight to sending. */
        const next = new URLSearchParams(global.location.search).get("next");
        global.location.href = next === "send" ? "send.html" : "blank.html";
        return;
      }
      say(reply.error === "busy" ? "יש עומס. נסי שוב בעוד כמה דקות." : "הקוד לא תקין.", true);
    } catch (e) {
      say("אין חיבור לשרת. נסי שוב מאוחר יותר.", true);
    }
    $("enter").disabled = false;
  }

  $("enter").addEventListener("click", enter);
  $("code").addEventListener("keydown", (e) => { if (e.key === "Enter") enter(); });
})(window);
