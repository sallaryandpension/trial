/* Draws each page on this device, empties the identifying areas and builds a new PDF. This page stays off the
   network. It can hand the result to the sending page only through the browser's own database (handoff.js). */
(function (global) {
  "use strict";
  const SCALE = 2.5; // about 180 dpi
  const Z = global.BlankZones, B = global.BlankPdf, S = global.Split;
  global.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

  async function blankPage(page) {
    const vp = page.getViewport({ scale: SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // The print intent keeps pdf.js off requestAnimationFrame, which stops in a hidden tab and would pause a long file.
    await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
    const size = page.getViewport({ scale: 1 });
    const read = ([x0, y0, x1, y1]) => ctx.getImageData(x0 * SCALE, y0 * SCALE, (x1 - x0) * SCALE, (y1 - y0) * SCALE).data;
    const found = Z.identify(size.width, size.height, read);
    if (!found) return { canvas: null, width: size.width, height: size.height, found: null };
    ctx.fillStyle = "#ffffff";
    for (const [, [x0, y0, x1, y1]] of found.zones) ctx.fillRect(x0 * SCALE, y0 * SCALE, (x1 - x0) * SCALE, (y1 - y0) * SCALE);
    return { canvas, width: size.width, height: size.height, found };
  }

  function toJpeg(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("image"));
    }, "image/jpeg", 0.9));
  }

  /* All or nothing: one page that isn't recognised stops the whole file.
     Each page becomes a JPEG and its full-size canvas is freed at once, so a file of hundreds of pages fits in memory. */
  async function process(data, onProgress) {
    const pdf = await global.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (onProgress) onProgress(n, pdf.numPages);
      const page = await pdf.getPage(n);
      const r = await blankPage(page);
      page.cleanup();
      if (!r.found) { await pdf.destroy(); return { refused: n, pages: pdf.numPages }; }
      const jpeg = await toJpeg(r.canvas);
      pages.push({
        jpeg, size: jpeg.size, side: r.found.side, pixelWidth: r.canvas.width, pixelHeight: r.canvas.height,
        width: r.width, height: r.height, zones: r.found.zones.length,
      });
      r.canvas.width = r.canvas.height = 0;
    }
    await pdf.destroy();
    return { pages };
  }

  const makePdf = (pages) => B.build(pages);
  const makeParts = (pages) => S.parts(pages).map((indexes) => B.build(indexes.map((i) => pages[i])));

  global.BlankApp = { process, makePdf, makeParts };

  const input = document.getElementById("pdf");
  if (!input) return;
  const $ = (id) => document.getElementById(id);
  let pages = [];
  let urls = [];
  const say = (text, error) => { $("status").textContent = text; $("status").classList.toggle("error", !!error); };
  const hasTicket = () => { try { return !!global.sessionStorage.getItem("ticket"); } catch (e) { return false; } };

  function clearShown() {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
    $("pages").textContent = "";
  }

  function show(indexes) {
    clearShown();
    for (const i of indexes) {
      const img = document.createElement("img");
      const url = URL.createObjectURL(pages[i].jpeg);
      urls.push(url);
      img.src = url;
      img.loading = "lazy";
      img.className = "page";
      img.alt = `עמוד ${i + 1}`;
      $("pages").append(img);
    }
  }

  function showResult() {
    const chosen = S.samples(pages);
    const partial = chosen.length < pages.length;
    show(chosen);
    $("sample-note").textContent = partial ? `מוצגים ${chosen.length} עמודים לדוגמה מתוך ${pages.length}, חזית וגב מכל תקופה. כל העמודים עברו את הבדיקה האוטומטית של התבנית.` : "";
    $("show-all").hidden = !partial;
    $("confirm-text").textContent = partial ? "בדקתי את העמודים שמוצגים" : "בדקתי את כל העמודים";
    $("confirm").checked = false;
    $("save").disabled = true;
    $("next").disabled = true;
    $("next").hidden = !hasTicket();
    $("results").hidden = false;
  }

  input.addEventListener("change", async () => {
    const file = input.files[0];
    pages = [];
    clearShown();
    $("results").hidden = true;
    if (!file) return;
    try {
      const res = await process(await file.arrayBuffer(), (n, t) => say(`מעבדים עמוד ${n} מתוך ${t}. בקובץ ארוך זה עשוי לקחת כמה דקות. לא לסגור את הלשונית.`));
      if (res.refused) {
        say(`עמוד ${res.refused} לא תואם לתבנית שאנחנו מכירים, ולכן לא נוצר קובץ. כך אנחנו מוודאים שפרט מזהה לא יישאר גלוי.`, true);
        return;
      }
      pages = res.pages;
      showResult();
      say("הקובץ החדש מוכן, ולא נשלח לשום מקום. עברי על העמודים לפני שממשיכים.");
    } catch (e) {
      say(e && e.name === "PasswordException" ? "הקובץ מוגן בסיסמה." : "לא הצלחנו לקרוא את הקובץ.", true);
    }
  });

  $("show-all").addEventListener("click", () => {
    show(pages.map((_, i) => i));
    $("show-all").hidden = true;
    $("sample-note").textContent = "";
  });
  $("confirm").addEventListener("change", () => {
    $("save").disabled = !$("confirm").checked;
    $("next").disabled = !$("confirm").checked;
  });
  $("save").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(makePdf(pages));
    a.download = "תלוש_בלי_פרטים_מזהים.pdf";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("next").addEventListener("click", async () => {
    $("next").disabled = true;
    try {
      await global.Handoff.put(makeParts(pages));
      global.location.href = "send.html";
    } catch (e) {
      say("לא הצלחנו להעביר את הקובץ לעמוד השליחה. ייתכן שהדפדפן במצב פרטי.", true);
      $("next").disabled = false;
    }
  });

  /* Anything left from an earlier visit that never reached the sending page is removed. */
  global.Handoff.clear().catch(() => {});
})(window);
