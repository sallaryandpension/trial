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
    let found = Z.identify(size.width, size.height, read);
    if (!found) {
      /* Another page size, such as the portal's own file: the side from the text, the place from the blue headings. */
      const side = Z.sideFromText((await page.getTextContent()).items.map((it) => it.str));
      if (side) {
        const share = Z.blueMap(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, SCALE);
        found = Z.identify(size.width, size.height, read, { share, side });
      }
    }
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
        width: r.width, height: r.height, zones: r.found.zones.length, shift: r.found.shift || null,
      });
      r.canvas.width = r.canvas.height = 0;
    }
    await pdf.destroy();
    return { pages };
  }

  /* Several files, in name order (so "2024-02" comes after "2024-01", and "10" after "9"). Still all or nothing:
     one unrecognised page in any file stops everything, and the answer says which file. */
  const byName = (a, b) => a.name.localeCompare(b.name, "he", { numeric: true });

  async function processFiles(files, onProgress) {
    const ordered = [...files].sort(byName);
    const pages = [];
    for (let f = 0; f < ordered.length; f++) {
      const res = await process(await ordered[f].data(), (n, t) => onProgress && onProgress(f + 1, ordered.length, n, t, ordered[f].name));
      if (res.refused) return { refused: res.refused, file: ordered[f].name };
      if (f > 0 && res.pages.length) res.pages[0].newFile = true;
      pages.push(...res.pages);
    }
    return { pages, files: ordered.length };
  }

  /* Pages she marked by hand get her boxes burnt into the image; the others are used as they are. */
  async function finalPages(pages) {
    const out = [];
    for (const p of pages) {
      if (!p.marks || !p.marks.length) { out.push(p); continue; }
      const jpeg = await global.Marks.burn(p.jpeg, p.pixelWidth, p.pixelHeight, p.marks);
      out.push(Object.assign({}, p, { jpeg, size: jpeg.size }));
    }
    return out;
  }
  const makePdf = async (pages) => B.build(await finalPages(pages));
  const makeParts = async (pages) => {
    const list = await finalPages(pages);
    return S.parts(list).map((indexes) => B.build(indexes.map((i) => list[i])));
  };
  const labelled = (blobs) => blobs.map((blob) => ({ blob, kind: "payslip" }));

  global.BlankApp = { process, processFiles, finalPages, makePdf, makeParts };

  const input = document.getElementById("pdf");
  if (!input) return;
  const $ = (id) => document.getElementById(id);
  let pages = [];
  let urls = [];
  let marking = false;
  const history = [];   // page indexes, in the order she drew her boxes
  const shown = new Map();   // page index -> its element
  const say =(text, error) => { $("status").textContent = text; $("status").classList.toggle("error", !!error); };
  const hasTicket = () => { try { return !!global.sessionStorage.getItem("ticket"); } catch (e) { return false; } };

  function clearShown() {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
    shown.clear();
    $("pages").textContent = "";
  }

  function drawMarks(i) {
    const wrap = shown.get(i);
    if (!wrap) return;
    wrap.querySelectorAll(".mark").forEach((el) => el.remove());
    for (const m of pages[i].marks) {
      const el = document.createElement("div");
      el.className = "mark";
      global.Marks.place(el, m);
      wrap.append(el);
    }
  }

  function unconfirm() {
    $("confirm").checked = false;
    ["save", "next"].forEach((id) => { $(id).disabled = true; });
  }

  function setMarking(on) {
    marking = on;
    $("mark").textContent = on ? "סימון ידני: פועל" : "סימון ידני: כבוי";
    $("mark").setAttribute("aria-pressed", String(on));
    $("mark-hint").hidden = !on;
    document.querySelectorAll(".sheet").forEach((s) => s.classList.toggle("marking", on));
  }

  /* Each page sits in a frame, so that after our blanking she can black out more herself. */
  function show(indexes) {
    clearShown();
    for (const i of indexes) {
      const wrap = document.createElement("div");
      wrap.className = marking ? "sheet marking" : "sheet";
      const img = document.createElement("img");
      const url = URL.createObjectURL(pages[i].jpeg);
      urls.push(url);
      img.src = url;
      img.loading = "lazy";
      img.draggable = false;
      img.alt = `עמוד ${i + 1}`;
      wrap.append(img);
      global.Marks.attach(wrap, pages[i].marks, () => marking, () => {
        history.push(i);
        $("undo").disabled = false;
        unconfirm();
      });
      $("pages").append(wrap);
      shown.set(i, wrap);
      drawMarks(i);
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
    $("next").hidden = false;
    $("no-ticket").hidden = hasTicket();
    $("results").hidden = false;
  }

  input.addEventListener("change", async () => {
    const files = [...input.files].map((file) => ({ name: file.name, data: () => file.arrayBuffer() }));
    pages = [];
    clearShown();
    $("results").hidden = true;
    $("unknown-doc").hidden = true;
    if (!files.length) return;
    const several = files.length > 1;
    try {
      const res = await processFiles(files, (f, total, n, t) => say(
        `${several ? `קובץ ${f} מתוך ${total}, ` : ""}מעבדים עמוד ${n} מתוך ${t}. בקובץ ארוך זה עשוי לקחת כמה דקות. לא לסגור את הלשונית.`));
      if (res.refused) {
        /* Not refused any more: the teacher goes on to the page that suggests what to hide, and she completes it. */
        const where = several ? `בקובץ "${res.file}", עמוד ${res.refused}` : `עמוד ${res.refused}`;
        say("");
        $("unknown-where").textContent = where;
        $("unknown-go").href = "pension.html?doc=payslip";
        $("unknown-doc").hidden = false;
        $("unknown-go").focus();
        return;
      }
      pages = res.pages.map((p) => Object.assign(p, { marks: [] }));
      history.length = 0;
      $("undo").disabled = true;
      setMarking(false);
      showResult();
      say(`${several ? `${res.files} קבצים אוחדו לקובץ אחד, ${pages.length} עמודים. ` : ""}הקובץ החדש מוכן, ולא נשלח לשום מקום. עברי על העמודים לפני שממשיכים.`);
    } catch (e) {
      say(e && e.name === "PasswordException" ? "אחד הקבצים מוגן בסיסמה." : "לא הצלחנו לקרוא את הקובץ.", true);
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
  const nextLabel = () => {
    $("next").textContent = $("want-pension").checked ? "המשך לדוח מהקופה" : "שליחה אלינו לבדיקה";
  };
  $("want-pension").addEventListener("change", nextLabel);
  $("mark").addEventListener("click", () => setMarking(!marking));
  $("undo").addEventListener("click", () => {
    const i = history.pop();
    if (i !== undefined) { pages[i].marks.pop(); drawMarks(i); }
    $("undo").disabled = !history.length;
    unconfirm();
  });
  $("save").addEventListener("click", async () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await makePdf(pages));
    a.download = "תלוש_בלי_פרטים_מזהים.pdf";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("next").addEventListener("click", async () => {
    $("next").disabled = true;
    try {
      await global.Handoff.put(labelled(await makeParts(pages)));
      /* With the pension check, the payslips wait in the browser while she blanks the fund's report; that page
         then sends both to one case. Without an entry code the file waits while she enters it. */
      global.location.href = $("want-pension").checked ? "pension.html" : (hasTicket() ? "send.html" : "index.html?next=send");
    } catch (e) {
      say("לא הצלחנו להעביר את הקובץ לשלב הבא. ייתכן שהדפדפן במצב פרטי.", true);
      $("next").disabled = false;
    }
  });

  /* Anything left from an earlier visit that never reached the sending page is removed. */
  global.Handoff.clear().catch(() => {});
})(window);
