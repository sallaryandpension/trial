/* The registration form. It collects consent and contact details only. There is no way to attach a file here. */
(function (global) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const C = global.CONSENT;
  const digits = (text) => text.replace(/\D/g, "");
  const validPhone = (text) => /^05\d{8}$/.test(digits(text));
  const validEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text.trim());

  function say(text, error) {
    $("status").textContent = text;
    $("status").classList.toggle("error", !!error);
  }

  function showNotice() {
    const notice = $("notice");
    const heading = document.createElement("h2");
    heading.textContent = C.title;
    notice.append(heading);
    for (const [title, text] of C.paragraphs) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = `${title}: `;
      p.append(strong, text);
      notice.append(p);
    }
    $("consent-data-text").textContent = C.consentData;
    $("consent-ai-text").textContent = C.consentAi;
    $("draft").hidden = !C.version.startsWith("DRAFT");
  }

  /* Both boxes are needed, and neither is ticked in advance (נוהל_ציות_משפטי.md, section 2). */
  function updateButton() {
    $("submit").disabled = !($("consent-data").checked && $("consent-ai").checked);
  }

  function problem() {
    if (!$("name").value.trim()) return "חסר שם.";
    if (!validEmail($("email").value)) return "כתובת המייל לא נראית תקינה.";
    if (!validPhone($("phone").value)) return "מספר הטלפון לא נראה כמו נייד ישראלי.";
    if (digits($("phone").value) !== digits($("phone2").value)) return "שני מספרי הטלפון לא זהים.";
    return "";
  }

  async function submit() {
    const wrong = problem();
    if (wrong) { say(wrong, true); return; }
    $("submit").disabled = true;
    say("שולחים...");
    try {
      const reply = await global.Api.call("register", {
        name: $("name").value.trim(), email: $("email").value.trim(), phone: digits($("phone").value),
        consentVersion: C.version, consentData: $("consent-data").checked, consentAi: $("consent-ai").checked,
        website: $("website").value,
      });
      if (reply.ok) {
        $("form").hidden = true;
        $("done").hidden = false;
        return;
      }
      say(reply.error === "busy" ? "יש עומס. נסי שוב בעוד כמה דקות." : "הפרטים לא התקבלו. בדקי אותם ונסי שוב.", true);
    } catch (e) {
      say("אין חיבור לשרת. נסי שוב מאוחר יותר.", true);
    }
    updateButton();
  }

  showNotice();
  $("consent-data").addEventListener("change", updateButton);
  $("consent-ai").addEventListener("change", updateButton);
  $("submit").addEventListener("click", submit);
})(window);
