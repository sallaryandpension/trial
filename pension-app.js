/* The pension report page. Reads each page's text on this device, lets PensionBlank decide what to black out, draws
   the page with those areas black and builds a new PDF from images only. The teacher can add boxes of her own.
   This page stays off the network; it hands the result to the sending page only through handoff.js. */
(function (global) {
  "use strict";
  const SCALE = 2;              // about 144 dpi, enough to read every figure
  const MAX_PART_BYTES = 15 * 1024 * 1024;
  const MAX_PART_PAGES = 40;
  const P = global.PensionBlank, B = global.BlankPdf;
  const LOCKED = new Set(["פרט שהקלדת"]);
  const lib = global.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

  /* Text pieces with boxes in points from the top left. */
  function itemsOf(content, vp) {
    const out = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const tx = lib.Util.transform(vp.transform, it.transform);
      const size = Math.hypot(tx[2], tx[3]) || it.height || 8;
      const angle = Math.atan2(tx[1], tx[0]);
      const len = it.width * vp.scale;
      const ends = [[tx[4], tx[5]], [tx[4] + Math.cos(angle) * len, tx[5] + Math.sin(angle) * len]];
      const xs = ends.map((p) => p[0]), ys = ends.map((p) => p[1]);
      const up = Math.abs(angle) > 0.1 ? size : 0;
      out.push({ str: it.str, x0: Math.min(...xs) - up, y0: Math.min(...ys) - size, x1: Math.max(...xs) + up, y1: Math.max(...ys) + size * 0.3 });
    }
    return out;
  }

  /* files: [{ name, data() }], in name order. Returns the open documents and what each page holds. */
  async function read(files) {
    const byName = (a, b) => a.name.localeCompare(b.name, "he", { numeric: true });
    const docs = [];
    const pages = [];
    for (const [f, file] of [...files].sort(byName).entries()) {
      const pdf = await lib.getDocument({ data: await file.data(), isEvalSupported: false }).promise;
      docs.push(pdf);
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const items = itemsOf(await page.getTextContent(), vp);
        const images = P.imageBoxes(await page.getOperatorList(), lib.OPS, vp.transform);
        pages.push({ doc: pdf, number: n, file: file.name, newFile: f > 0 && n === 1, items, images, size: { width: vp.width, height: vp.height } });
        page.cleanup();
      }
    }
    return { docs, pages };
  }

  /* Share of the page that is not white, from a sample of pixels. */
  function ink(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;
    let dark = 0, seen = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      seen += 1;
      if (data[i] + data[i + 1] + data[i + 2] < 600) dark += 1;
    }
    return dark / seen;
  }

  function toJpeg(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image"))), "image/jpeg", 0.9));
  }

  function fill(ctx, boxes, scale) {
    ctx.fillStyle = "#000000";
    for (const b of boxes) ctx.fillRect(b.x0 * scale, b.y0 * scale, (b.x1 - b.x0) * scale, (b.y1 - b.y0) * scale);
  }

  /* The whole path. Refuses rather than guesses: a scanned page, a page with no readable text but with print on it,
     or an ID number that can't be found in the file at all, which means the text can't be trusted. */
  async function run(files, input, onProgress, options) {
    const payslip = !!(options && options.doc === "payslip");
    const { docs, pages } = await read(files);
    try {
      const decision = P.decide(pages, input, options);
      if (decision.refused) return { refused: decision.refused, pages: pages.length, file: decision.refused.page ? pages[decision.refused.page - 1].file : null };
      const out = [];
      for (const [i, p] of pages.entries()) {
        if (onProgress) onProgress(i + 1, pages.length);
        const page = await p.doc.getPage(p.number);
        const vp = page.getViewport({ scale: SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
        page.cleanup();
        const textChars = p.items.reduce((s, it) => s + it.str.replace(/\s/g, "").length, 0);
        const noText = textChars < 20 && ink(ctx, canvas.width, canvas.height) > 0.01;
        if (noText && !payslip) {
          return { refused: { reason: "no-text", page: i + 1 }, file: p.file, pages: pages.length };
        }
        /* The page is kept as drawn, on this device only, so that a box she cancels shows what is under it. Our boxes
           are a suggestion she can switch off, except the ones over what she typed herself. A payslip page with no
           readable text gets no suggestion at all; it is marked, and she blacks it out herself. */
        const clean = await toJpeg(canvas);
        const unreadable = payslip && (noText || !!decision.pages[i].unreadable);
        const boxes = unreadable ? [] : decision.pages[i].boxes.map((b) => Object.assign({}, b, { on: true, locked: LOCKED.has(b.why) }));
        out.push({ clean, pixelWidth: canvas.width, pixelHeight: canvas.height, width: p.size.width, height: p.size.height,
          boxes, marks: [], file: p.file, unreadable });
        canvas.width = canvas.height = 0;
      }
      return { pages: out, known: decision.known, typed: decision.typed, idMissing: !!decision.idMissing };
    } finally {
      for (const d of docs) await d.destroy();
    }
  }

  /* Switches one of our boxes on or off. Returns false for a box that can't be switched off. */
  function toggle(page, index) {
    const b = page.boxes[index];
    if (!b || b.locked) return false;
    b.on = !b.on;
    return true;
  }

  /* The file is built from the page as drawn, with the boxes that are on and her own boxes. */
  async function finalPage(p) {
    const jpeg = await global.Marks.burn(p.clean, p.pixelWidth, p.pixelHeight, p.marks,
      (ctx) => fill(ctx, p.boxes.filter((b) => b.on || b.locked), p.pixelWidth / p.width));
    return { jpeg, size: jpeg.size, pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight, width: p.width, height: p.height, file: p.file };
  }

  async function finalPages(pages) {
    const out = [];
    for (const p of pages) out.push(await finalPage(p));
    return out;
  }

  function parts(pages) {
    const out = [];
    let part = [], bytes = 0;
    for (const p of pages) {
      if (part.length && (part.length >= MAX_PART_PAGES || bytes + p.size > MAX_PART_BYTES)) { out.push(part); part = []; bytes = 0; }
      part.push(p);
      bytes += p.size;
    }
    if (part.length) out.push(part);
    return out.map((list) => B.build(list));
  }

  global.PensionApp = { read, run, toggle, finalPages, parts };

  const input = document.getElementById("pdf");
  if (!input) return;
  const $ = (id) => document.getElementById(id);
  let pages = [];
  let urls = [];
  let marking = false;
  const history = [];   // what she did, in order: { mark: { page, el } } or { box: { page, index, el } }
  const say = (text, error) => { $("status").textContent = text; $("status").classList.toggle("error", !!error); };
  const hasTicket = () => { try { return !!global.sessionStorage.getItem("ticket"); } catch (e) { return false; } };

  /* The same page serves a payslip the template didn't recognise (pension.html?doc=payslip): the payslip wording,
     the payslip labels, nothing refused, and the result goes on as payslips. */
  const DOC = new URLSearchParams(global.location.search).get("doc") === "payslip" ? "payslip" : "pension";
  document.querySelectorAll("[data-doc]").forEach((el) => { el.hidden = el.dataset.doc !== DOC; });
  if (DOC === "payslip") {
    document.title = "תלוש בלי פרטים מזהים";
    $("want-pension").checked = new URLSearchParams(global.location.search).get("pension") === "1";
  }

  function terms() {
    return {
      id: $("id").value,
      names: [$("name").value, ...$("others").value.split(/[,،]/)],
      accounts: $("accounts").value.split(/[,،;\s]+/),
    };
  }

  /* Every field is optional. Only an ID that was typed and is wrong holds her up, since it would find nothing. */
  function ready() {
    const id = $("id").value.replace(/\D/g, "");
    const bad = id.length > 0 && !(id.length >= 5 && P.validId(id));
    input.disabled = bad;
    $("dz-hint").textContent = bad ? "מספר הזהות לא תקין. אפשר לתקן אותו, או למחוק אותו ולהשאיר ריק"
      : "אפשר לבחור כמה קבצים יחד. הם נפתחים רק במחשב הזה";
  }

  function clearShown() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    history.length = 0;
    $("undo").disabled = true;
    $("restore").disabled = true;
    $("pages").textContent = "";
  }

  /* One of our boxes, over the page. A click switches it off (a red frame shows where it was) or back on. */
  function autoBox(p, index) {
    const b = p.boxes[index];
    const el = document.createElement(b.locked ? "div" : "button");
    el.className = b.locked ? "auto locked" : "auto";
    const x0 = Math.max(0, b.x0), y0 = Math.max(0, b.y0);
    place(el, { x: x0 / p.width, y: y0 / p.height, w: (Math.min(p.width, b.x1) - x0) / p.width, h: (Math.min(p.height, b.y1) - y0) / p.height });
    el.title = b.locked ? `${b.why}. נשאר תמיד` : `${b.why}. לחיצה מבטלת או מחזירה`;
    if (!b.locked) {
      el.type = "button";
      const label = () => el.setAttribute("aria-label", `${b.why}: ${b.on ? "מוסתר. לחיצה תבטל את ההסתרה" : "גלוי. לחיצה תסתיר שוב"}`);
      label();
      el.addEventListener("click", () => {
        if (marking || !toggle(p, index)) return;
        el.classList.toggle("off", !b.on);
        label();
        history.push({ box: { page: p, index, el, label } });
        changed();
      });
      el.refresh = label;
    }
    return el;
  }

  function changed() {
    $("undo").disabled = !history.length;
    $("restore").disabled = !pages.some((p) => p.boxes.some((b) => !b.on));
    $("summary").textContent = summary();
    unconfirm();
  }

  function setMarking(on) {
    marking = on;
    $("mark").textContent = on ? "סימון ידני: פועל" : "סימון ידני: כבוי";
    $("mark").setAttribute("aria-pressed", String(on));
    $("mark-hint").hidden = !on;
    document.querySelectorAll(".sheet").forEach((s) => s.classList.toggle("marking", on));
  }

  const place = global.Marks.place;

  function sheet(p, index) {
    const wrap = document.createElement("div");
    wrap.className = "sheet";
    if (p.unreadable) {
      /* No suggestion here: the page has no text we can read. */
      const note = document.createElement("p");
      note.className = "notice";
      note.textContent = `עמוד ${index + 1}: לא הצלחנו לקרוא את הטקסט בעמוד הזה, ולכן אין בו הצעה. סמני בעצמך כל פרט מזהה.`;
      $("pages").append(note);
    }
    const img = document.createElement("img");
    const url = URL.createObjectURL(p.clean);
    urls.push(url);
    img.src = url;
    img.alt = `עמוד ${index + 1}`;
    img.draggable = false;
    wrap.append(img);
    /* Large boxes first, so a small box inside a large one stays on top and can be clicked on its own. */
    const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
    p.boxes.map((b, i) => i).sort((a, b) => area(p.boxes[b]) - area(p.boxes[a])).forEach((i) => wrap.append(autoBox(p, i)));
    global.Marks.attach(wrap, p.marks, () => marking, (el) => {
      history.push({ mark: { page: p, el } });
      changed();
    });
    return wrap;
  }

  function unconfirm() {
    $("confirm").checked = false;
    $("save").disabled = true;
    $("next").disabled = true;
  }

  function summary() {
    const counts = {};
    let off = 0, marks = 0;
    for (const p of pages) {
      marks += p.marks.length;
      for (const b of p.boxes) {
        if (!b.on) { off += 1; continue; }
        counts[b.why] = (counts[b.why] || 0) + 1;
      }
    }
    const list = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · ");
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return `${pages.length} עמודים. מוצע להסתיר ${total} אזורים${list ? ` (${list})` : ""}.`
      + (off ? ` ביטלת ${off}.` : "") + (marks ? ` סימנת בעצמך ${marks}.` : "");
  }

  function showResult(known, typed, idMissing) {
    clearShown();
    pages.forEach((p, i) => $("pages").append(sheet(p, i)));
    setMarking(false);
    $("unknown").hidden = known || DOC === "payslip";
    $("untyped").hidden = typed;
    $("id-missing").hidden = !idMissing;
    $("summary").textContent = summary();
    unconfirm();
    $("no-ticket").hidden = hasTicket();
    $("results").hidden = false;
  }

  const REFUSED = {
    scanned: (r) => `${r.where} נראה סרוק או מצולם. בעמוד כזה אי אפשר לקרוא את הטקסט, ולכן לא נוצר קובץ. צריך להוריד מאתר הקופה את הדוח עצמו כ-PDF.`,
    "no-text": (r) => `ב${r.where} יש תוכן אבל אין טקסט שאפשר לקרוא, ולכן לא נוצר קובץ. צריך להוריד מאתר הקופה את הדוח עצמו כ-PDF.`,
    "id-not-found": () => "לא מצאנו בקובץ את מספר הזהות שהקלדת. כנראה שאי אפשר לקרוא נכון את הטקסט בקובץ הזה, ואז גם ההצעה להסתרה לא תהיה אמינה. כדאי לבדוק את המספר, ושהקובץ הוא הדוח שהורד מאתר הקופה. אפשר גם למחוק את מספר הזהות מהשדה ולהסתיר בעצמך.",
  };

  input.addEventListener("change", async () => {
    const files = [...input.files].map((file) => ({ name: file.name, data: () => file.arrayBuffer() }));
    pages = [];
    clearShown();
    $("results").hidden = true;
    if (!files.length) return;
    const several = files.length > 1;
    say("קוראים את הקובץ...");
    try {
      const res = await run(files, terms(), (n, t) => say(`מעבדים עמוד ${n} מתוך ${t}. לא לסגור את הלשונית.`), { doc: DOC });
      input.value = "";
      if (res.refused) {
        const r = res.refused;
        const where = r.page ? (several ? `בקובץ "${res.file}", עמוד ${r.page}` : `עמוד ${r.page}`) : "";
        say(REFUSED[r.reason]({ where: where || "הקובץ" }), true);
        return;
      }
      pages = res.pages;
      showResult(res.known, res.typed, res.idMissing);
      say("ההצעה שלנו מוכנה, ושום דבר לא נשלח. עברי על כל העמודים ותקני לפני שממשיכים.");
    } catch (e) {
      input.value = "";
      say(e && e.name === "PasswordException" ? "אחד הקבצים מוגן בסיסמה. צריך לפתוח אותו ולשמור עותק בלי סיסמה." : "לא הצלחנו לקרוא את הקובץ.", true);
    }
  });

  $("id").addEventListener("input", ready);
  /* Changing what to hide after the file was made means making it again. */
  ["id", "name", "others", "accounts"].forEach((id) => $(id).addEventListener("input", () => {
    if (!$("results").hidden) { pages = []; clearShown(); $("results").hidden = true; say("הפרטים השתנו. בוחרים את הקובץ שוב."); }
  }));
  $("mark").addEventListener("click", () => setMarking(!marking));
  $("undo").addEventListener("click", () => {
    const last = history.pop();
    if (last && last.mark) {
      const { page, el } = last.mark;
      page.marks.splice(page.marks.length - 1, 1);
      el.remove();
    } else if (last && last.box) {
      const { page, index, el, label } = last.box;
      toggle(page, index);
      el.classList.toggle("off", !page.boxes[index].on);
      label();
    }
    changed();
  });
  $("restore").addEventListener("click", () => {
    for (const p of pages) p.boxes.forEach((b) => { b.on = true; });
    document.querySelectorAll(".sheet .auto.off").forEach((el) => { el.classList.remove("off"); if (el.refresh) el.refresh(); });
    history.splice(0, history.length, ...history.filter((h) => h.mark));
    changed();
  });
  $("confirm").addEventListener("change", () => {
    $("save").disabled = !$("confirm").checked;
    $("next").disabled = !$("confirm").checked;
  });
  $("save").addEventListener("click", async () => {
    const list = await finalPages(pages);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(B.build(list));
    a.download = DOC === "payslip" ? "תלוש_בלי_פרטים_מזהים.pdf" : "דוח_קופה_בלי_פרטים_מזהים.pdf";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("next").addEventListener("click", async () => {
    $("next").disabled = true;
    try {
      const made = parts(await finalPages(pages));
      if (DOC === "payslip") {
        /* Payslips start the case afresh; with the pension check she goes on to the fund's report next. */
        await global.Handoff.put(made.map((blob) => ({ blob, kind: "payslip" })));
        if ($("want-pension").checked) { global.location.href = "pension.html"; return; }
      } else {
        await global.Handoff.add(made.map((blob) => ({ blob, kind: "pension" })));
      }
      /* Without an entry code the file waits in the browser while she enters it, then she goes on to sending. */
      global.location.href = hasTicket() ? "send.html" : "index.html?next=send";
    } catch (e) {
      say("לא הצלחנו להעביר את הקובץ לעמוד השליחה. ייתכן שהדפדפן במצב פרטי.", true);
      $("next").disabled = false;
    }
  });

  const nextLabel = () => {
    $("next").textContent = DOC === "payslip" && $("want-pension").checked ? "המשך לדוח מהקופה" : "שליחה אלינו לבדיקה";
  };
  $("want-pension").addEventListener("change", nextLabel);
  nextLabel();

  /* Payslips made on the payslip page wait here, and are sent together with this report. */
  if (DOC === "pension") global.Handoff.count().then((n) => {
    if (n) {
      $("waiting").textContent = `התלושים שהכנת ממתינים (${n === 1 ? "חלק אחד" : `${n} חלקים`}), ויישלחו יחד עם הדוח הזה, לאותו תיק. `;
      /* She ticked the pension check but has no report from the fund after all: the payslips go on their own. */
      const skip = document.createElement("a");
      skip.href = hasTicket() ? "send.html" : "index.html?next=send";
      skip.textContent = "אין לי דוח מהקופה: שליחת התלושים בלבד";
      $("waiting").append(skip);
      $("waiting").hidden = false;
    }
  }).catch(() => {});
  ready();
})(window);
