/* The operator's phone app: asks the server for three new entry codes and prepares the SMS. The codes are shown
   only here and are not stored on the phone. The phone key, which can do nothing but make codes, is kept in this
   phone's storage; it arrives once after the # in the address from the cases window's QR code. */
(function (global) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const KEY = "codeKey";
  const store = {
    get() { try { return global.localStorage.getItem(KEY) || ""; } catch (e) { return ""; } },
    set(value) { try { global.localStorage.setItem(KEY, value); } catch (e) { /* private mode: works for this visit only */ } },
    clear() { try { global.localStorage.removeItem(KEY); } catch (e) { /* nothing kept */ } },
  };
  let key = "";
  let codes = [];

  /* The key arrives as #k=..., is saved, and is removed from the address at once. */
  const match = /(?:^#|&)k=([A-Za-z0-9_-]{20,100})/.exec(global.location.hash);
  if (match) {
    store.set(match[1]);
    key = match[1];
    global.history.replaceState(null, "", global.location.pathname);
  } else {
    key = store.get();
  }

  function say(text, error) {
    $("status").textContent = text;
    $("status").classList.toggle("error", !!error);
  }

  const entryUrl = () => new URL("index.html", global.location.href).href;
  const digits = (text) => text.replace(/\D/g, "");

  function message() {
    return ["שלום, תודה שנרשמת לבדיקת התלוש.", "קודי הכניסה שלך (אם הראשון לא עובד, נסי את הבא):", ...codes, "",
      `נכנסים כאן: ${entryUrl()}`, "כל קוד תקף לשימוש אחד."].join("\n");
  }

  function updateSms() {
    const phone = digits($("phone").value);
    $("sms").href = `sms:${phone}?body=${encodeURIComponent(message())}`;
  }

  async function make() {
    $("make").disabled = true;
    say("מבקשים קודים...");
    try {
      const reply = await global.Api.call("issueCodes", { token: key });
      if (reply.ok) {
        codes = reply.codes;
        const list = $("codes");
        list.textContent = "";
        for (const code of codes) {
          const li = document.createElement("li");
          li.textContent = code;
          list.append(li);
        }
        $("result").hidden = false;
        updateSms();
        say("שלושה קודים חדשים מוכנים.");
      } else if (reply.error === "denied") {
        store.clear();
        say("הטלפון נותק מהשרת. צריך לחבר אותו מחדש מחלון התיקים במחשב.", true);
      } else {
        say(reply.error === "busy" ? "יותר מדי לחיצות בשעה האחרונה. אפשר לנסות שוב מאוחר יותר." : "לא התקבלו קודים. אפשר לנסות שוב.", true);
      }
    } catch (e) {
      say("אין חיבור לשרת. בודקים את האינטרנט ומנסים שוב.", true);
    }
    $("make").disabled = false;
  }

  $("make").addEventListener("click", make);
  $("phone").addEventListener("input", updateSms);
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(message()); say("ההודעה הועתקה."); } catch (e) { say("ההעתקה לא הצליחה.", true); }
  });

  $("app").hidden = !key;
  $("not-linked").hidden = !!key;
})(window);
