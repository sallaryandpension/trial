/* Decides what to black out on a pension or provident fund report. Pure logic, no drawing: it gets the text pieces
   of a page with their boxes, in PDF points from the top left, and returns boxes to black out.

   The Capital Market Authority circular 2020-9-22 fixes the wording of the annual report to members, so the labels of
   the identifying fields are the same at every company (ריקון_דוחות_פנסיה_מחקר.md). Four layers, any one is enough:
     1. Labels from the circular: the line that holds the label is blacked out, and some sections as a whole.
     2. What the teacher typed on her device (ID, name, account numbers): every place it appears.
     3. Patterns: a valid ID number, phones, e-mail, long numbers without separators. Amounts have separators and stay.
     4. Images (logo, QR codes): always blacked out. The teacher adds her own boxes on top of all this.
   Blacking out too much is safe. What must not happen is a detail left visible, so the page refuses what it can't read. */
(function (global) {
  "use strict";

  const norm = (s) => String(s || "")
    .replace(/[֑-ׇ]/g, "")              // niqqud
    .replace(/[״"“”„]/g, '"').replace(/[׳'‘’`]/g, "'")
    .replace(/[\s‎‏‪-‮:;_|\\/–—-]+/g, "")
    .toLowerCase();
  const reverse = (s) => [...s].reverse().join("");

  /* A label counts when the line holds it in reading order or, as some PDF makers write Hebrew, reversed. */
  const LINE_LABELS = [
    "שם העמית", "שם המבוטח", "שם החוסך", "שם הלקוח", "שם העובד",
    "מספר תעודת זהות", "מס' תעודת זהות", "מספר ת.ז", "מס' ת.ז", "תעודת זהות", "ת.ז.", "מספר זהות", "מספר דרכון",
    "מספר חשבון", "מספרי חשבונות", "מספר פוליסה", "מספרי פוליסות", "מספר עמית", "מספר תיק ניכויים", "מספר מעסיק",
    "תאריך לידה", "מצב משפחתי", "מין העמית", "מין המבוטח",
    "כתובת למשלוח דואר", "כתובת דואר אלקטרוני", 'דוא"ל', "מען", "מיקוד", "טלפון נייד", "מס' טלפון",
    "שם המעסיק", "שם המעסיק האחרון", "מועד הצטרפות לראשונה", "שם סוכן", "שם יועץ", "פרטי התקשרות",
    "שם משפחה", "שם פרטי", "שם מלא", "לכבוד",
  ].map(norm);
  /* A letter's address block: "לכבוד" and the short lines right under it. */
  const ADDRESSEE = norm("לכבוד");
  /* For a payslip that isn't in the known template: labels of the identifying fields on payslips. */
  const PAYSLIP_LABELS = [
    "שם העובד", "שם עובד", "מספר עובד", "מס' עובד", "מס עובד", "מספר זהות", "ת.ז", "כתובת", "בנק", "סניף",
    "מספר חשבון", "חשבון בנק", "שם בית הספר", "שם בית ספר", "שם המוסד", "שם מוסד", "סמל מוסד", "תאריך לידה",
    "מצב משפחתי", "בן/בת זוג", "בן זוג", "בת זוג", "תאריך תחילת עבודה", "פקיד שכר", "פקידת שכר", "טלפון",
  ].map(norm);
  /* "ת.ז." normalises to "ת.ז." and would match inside ordinary words rarely; the short ones need a word edge. */
  const SHORT = new Set(["ת.ז.", "ת.ז", "מען", "מיקוד", 'דוא"ל', "בנק", "סניף"].map(norm));

  /* From the start of these sections to their end, everything goes: the form to update personal details holds the
     address, phones and the details of the spouse and of the children, who never agreed to anything. */
  const BLOCK_START = ["הודעה על עדכון/תיקון פרטים אישיים", "הודעה על עדכון פרטים אישיים", "פרטים אישיים של בן / בת הזוג",
    "פרטי בן/בת הזוג", "ילדים עד גיל 21", "פרטיך האישיים כפי"].map(norm);
  const BLOCK_END = ["הסברים ודגשים", "מילון מושגים"].map(norm);

  /* The table of deposits has a column for the employer's name when there are several employers. */
  const DEPOSIT_HEADERS = ["מועד הפקדה", "עבור חודש", "חודש משכורת", "תגמולי עובד", "תגמולי מעסיק", "פיצויים", "משכורת"].map(norm);
  const EMPLOYER = norm("המעסיק");
  const TOTAL = norm('סה"כ');

  const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
  const PHONE = /(?<!\d)(?:\+?972[\s-]?|0)(?:5\d|[23489]|7\d)[\s-]?\d{3}[\s-]?\d{4}(?!\d)/;
  const LONG = /(?<![\d.,])\d{7,}(?![\d.,]*\d)/;
  const JOINED = /(?<![\d.,])\d{2,}[-/]\d{5,}(?![\d.,]*\d)/;  // 123-456789: an account, not a date (01/2024)
  const DIGIT_RUN = /\d[\d\s-]{6,12}\d/g;

  /* Israeli ID check digit (also for 8 digits, padded with a leading zero). */
  function validId(digits) {
    if (!/^\d{5,9}$/.test(digits)) return false;
    const d = digits.padStart(9, "0");
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let n = Number(d[i]) * ((i % 2) + 1);
      if (n > 9) n -= 9;
      sum += n;
    }
    return sum % 10 === 0 && Number(d) > 0;
  }

  function hasId(text) {
    for (const m of String(text).matchAll(DIGIT_RUN)) {
      const digits = m[0].replace(/\D/g, "");
      if ((digits.length === 9 || digits.length === 8) && validId(digits)) return true;
    }
    return false;
  }

  const STREET = /(?:^|[\s,])(?:רח'|רח׳|רחוב|שד'|שד׳|שדרות|ת\.ד|ת"ד|ת״ד|סמטת)\s*\S+/;

  function patternOf(text) {
    if (EMAIL.test(text)) return 'דוא"ל';
    if (STREET.test(text)) return "כתובת";
    if (hasId(text)) return "מספר זהות";
    if (PHONE.test(text)) return "טלפון";
    if (LONG.test(text) || JOINED.test(text)) return "מספר ארוך";
    return null;
  }

  /* What the teacher typed. Digits are compared without leading zeros or separators. */
  function prepareTerms(input) {
    const digits = [];
    const words = [];
    const addDigits = (s, min) => {
      const d = String(s || "").replace(/\D/g, "").replace(/^0+/, "");
      if (d.length >= min) digits.push(d);
    };
    addDigits(input && input.id, 5);
    for (const a of (input && input.accounts) || []) addDigits(a, 5);
    for (const n of (input && input.names) || []) {
      for (const w of String(n || "").split(/[\s,.\-'"״׳()]+/)) {
        const x = norm(w);
        if (x.length >= 2 && !/^\d+$/.test(x)) words.push(x);
      }
    }
    return { digits: [...new Set(digits)], words: [...new Set(words)], id: digits[0] && input && input.id ? digits[0] : "" };
  }

  const wordsOf = (s) => String(s || "").split(/[\s,.:;()\[\]{}"'״׳/\\|–—-]+/).map(norm).filter(Boolean);

  function termHit(text, terms) {
    if (terms.digits.length) {
      const d = String(text).replace(/\D/g, "").replace(/^0+/, "");
      if (d && terms.digits.some((t) => d.includes(t))) return "פרט שהקלדת";
    }
    if (terms.words.length) {
      const ws = wordsOf(text);
      for (const w of ws) if (terms.words.some((t) => w === t || reverse(w) === t)) return "פרט שהקלדת";
      const whole = norm(text);
      if (terms.words.some((t) => t.length >= 4 && (whole.includes(t) || whole.includes(reverse(t))))) return "פרט שהקלדת";
    }
    return null;
  }

  /* Items: [{ str, x0, y0, x1, y1 }]. Lines: items whose vertical middles are close. */
  function toLines(items) {
    const sorted = items.filter((it) => String(it.str).trim()).slice().sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const lines = [];
    for (const it of sorted) {
      const mid = (it.y0 + it.y1) / 2;
      const h = it.y1 - it.y0;
      const line = lines.find((l) => Math.abs(l.mid - mid) <= Math.max(2, Math.min(h, l.h) * 0.45));
      if (line) {
        line.items.push(it);
        line.y0 = Math.min(line.y0, it.y0); line.y1 = Math.max(line.y1, it.y1);
      } else lines.push({ items: [it], mid, h, y0: it.y0, y1: it.y1 });
    }
    for (const l of lines) {
      const rtl = l.items.slice().sort((a, b) => b.x1 - a.x1).map((it) => it.str).join(" ");
      const ltr = l.items.slice().sort((a, b) => a.x0 - b.x0).map((it) => it.str).join(" ");
      l.texts = [norm(rtl), norm(ltr)];
      l.texts.push(...l.texts.map(reverse));
      l.x0 = Math.min(...l.items.map((it) => it.x0)); l.x1 = Math.max(...l.items.map((it) => it.x1));
    }
    return lines.sort((a, b) => a.y0 - b.y0);
  }

  const lineHas = (line, label) => line.texts.some((t) => {
    if (!SHORT.has(label)) return t.includes(label);
    const at = t.indexOf(label);
    return at >= 0 && (at === 0 || !/[א-ת]/.test(t[at - 1]) || t.length === label.length);
  });

  const PAD = 1.5;
  const box = (x0, y0, x1, y1, why) => ({ x0: x0 - PAD, y0: y0 - PAD, x1: x1 + PAD, y1: y1 + PAD, why });

  /* The employer column: from its header down to the totals line (or the page end), between the middles of the gaps
     to the neighbouring headers. */
  const isDepositHeader = (l) => DEPOSIT_HEADERS.filter((h) => lineHas(l, h)).length >= 2;

  function employerColumns(lines, width, height) {
    const out = [];
    lines.forEach((line, i) => {
      /* The header may be wrapped over two lines ("שם" above "המעסיק"); a data row is never part of it. */
      const near = [lines[i - 1], line, lines[i + 1]].filter((l) => l && (l === line || isDepositHeader(l)
        || l.items.every((o) => norm(o.str).length <= 14 && !/\d/.test(o.str))));
      if (!near.some((l) => DEPOSIT_HEADERS.some((h) => lineHas(l, h)))) return;
      for (const it of line.items) {
        const t = norm(it.str);
        if (!(t.includes(EMPLOYER) || reverse(t).includes(EMPLOYER)) || t.length > 14) continue;
        const heads = near.flatMap((l) => l.items).filter((o) => o !== it);
        const left = heads.filter((o) => o.x1 <= it.x0 + 0.5).reduce((m, o) => Math.max(m, o.x1), 0);
        const right = heads.filter((o) => o.x0 >= it.x1 - 0.5).reduce((m, o) => Math.min(m, o.x0), width);
        /* Between the middles of the gaps to the neighbouring headings; at the edge of the table, a little beyond the
           heading, not to the edge of the page. Longer names are caught piece by piece below. */
        const x0 = left ? (left + it.x0) / 2 : Math.max(0, it.x0 - 40);
        const x1 = right < width ? (it.x1 + right) / 2 : Math.min(width, it.x1 + 30);
        const top = Math.max(...near.map((l) => l.y1));
        const end = lines.find((l) => l.y0 > top && l.texts.some((tx) => tx.startsWith(TOTAL) || tx.endsWith(reverse(TOTAL))));
        const bottom = end ? end.y0 - PAD * 2 : height;
        out.push(box(x0, top, x1, bottom, "עמודת שם המעסיק"));
        /* A long name sticks out of the column: the whole piece goes when its middle is in the column. */
        for (const l of lines) {
          if (l.y0 < top || l.y1 > bottom + PAD * 2) continue;
          for (const o of l.items) {
            const mid = (o.x0 + o.x1) / 2;
            if (mid >= x0 && mid <= x1) out.push(box(o.x0, o.y0, o.x1, o.y1, "עמודת שם המעסיק"));
          }
        }
      }
    });
    return out;
  }

  /* Pieces of a line that sit close together, as one word or one value printed in parts. */
  function runs(line) {
    const sorted = line.items.slice().sort((a, b) => a.x0 - b.x0);
    const out = [];
    for (const it of sorted) {
      const last = out[out.length - 1];
      const gap = last ? it.x0 - Math.max(...last.map((o) => o.x1)) : Infinity;
      if (last && gap < Math.max(4, line.h * 0.9)) last.push(it);
      else out.push([it]);
    }
    return out;
  }

  /* The value that belongs to each label on a line. Hebrew reads right to left, so the value is to the label's left,
     up to the next label, a wide gap, or MAX_VALUE points, about thirty characters: a name, a number or an address,
     and not the rest of the line. A piece that holds the label and the value together is cut by its letters. */
  const MAX_VALUE = 170;
  function valueBoxes(line, found) {
    const isLabelPiece = (it) => {
      const t = norm(it.str);
      if (!t) return false;
      return found.some((l) => t === l || l.includes(t) || l.includes(reverse(t)) || t.includes(l) || t.includes(reverse(l)));
    };
    const pieces = line.items.slice().sort((a, b) => b.x1 - a.x1);   // right to left
    const out = [];
    const labelBoxes = [];
    pieces.forEach((it, i) => {
      if (!isLabelPiece(it)) return;
      const t = norm(it.str);
      const own = found.filter((l) => t.includes(l) || t.includes(reverse(l))).reduce((m, l) => Math.max(m, l.length), 0);
      labelBoxes.push(it);
      /* Label and value in one piece: the label's share of the letters is on the right; the rest is the value.
         But when a separate piece follows, the extra words belong to a longer label ("שם סוכן/יועץ") and the
         value is that piece. */
      const follows = pieces.slice(i + 1).find((v) => !isLabelPiece(v));
      const nextLabel = pieces.slice(i + 1).find(isLabelPiece);
      const hasOwnValue = follows && (!nextLabel || follows.x1 > nextLabel.x1);
      const colon = /\S\s*:\s*\S/.test(String(it.str));   // "שם העמית: דמיונה": the value is right here
      if (own && t.length - own > 2 && (colon || !hasOwnValue)) {
        const valueShare = (t.length - own) / t.length;
        out.push(box(it.x0, it.y0, it.x0 + (it.x1 - it.x0) * valueShare, it.y1, "ערך ליד תווית"));
        return;
      }
      /* The value starts at the nearest piece to the left, wherever it is (in a table it sits in the next cell), and
         runs on while the pieces stay close, for at most MAX_VALUE points. */
      let start = null, edge = 0;
      for (const v of pieces.slice(i + 1)) {
        if (isLabelPiece(v)) break;
        if (start === null) start = v.x1;
        else if (edge - v.x1 > Math.max(12, line.h * 1.5)) break;   // a gap: the next column, not this value
        if (v.x1 < start - MAX_VALUE) break;
        out.push(box(Math.max(v.x0, start - MAX_VALUE), v.y0, v.x1, v.y1, "ערך ליד תווית"));
        edge = v.x0;
      }
    });
    return { boxes: out, labels: labelBoxes };
  }

  /* One page. state carries an open section into the next page. Returns { boxes, labels, idFound, text }. */
  function page(items, size, terms, state, labelList) {
    const LABELS = labelList || LINE_LABELS;
    const { width, height } = size;
    const lines = toLines(items);
    const boxes = [];
    let labels = 0;
    let blockFrom = state.inBlock ? 0 : null;
    lines.forEach((line, i) => {
      if (blockFrom !== null && BLOCK_END.some((l) => lineHas(line, l))) {
        boxes.push(box(0, blockFrom, width, line.y0 - PAD * 2, "פרטים אישיים ובני משפחה"));
        blockFrom = null;
      }
      if (blockFrom === null && BLOCK_START.some((l) => lineHas(line, l))) {
        blockFrom = line.y0;
        labels += 1;
      }
      const found = isDepositHeader(line) ? [] : LABELS.filter((l) => lineHas(line, l));
      if (found.length) {
        if (found.some((l) => l !== ADDRESSEE)) labels += 1;   // "לכבוד" alone doesn't make it the circular's report
        /* Only the value next to each label, not the whole line: labels stay readable, and so does anything else on
           the line, such as an amount. */
        const valued = valueBoxes(line, found);
        boxes.push(...valued.boxes);
        /* A line of labels only: the values are in the line below it, under each label, as in a table with the
           headings on top. */
        let rest = line.texts[0];
        for (const l of found.sort((a, b) => b.length - a.length)) rest = rest.split(l).join("");
        const next = lines[i + 1];
        if (rest.length <= 3 && next && next.y0 - line.y1 < 2 * Math.max(line.h, next.h)) {
          for (const lab of valued.labels) {
            const span = [lab.x0 - 30, lab.x1 + 30];
            for (const o of next.items) {
              if (o.x1 > span[0] && o.x0 < span[1]) boxes.push(box(o.x0, o.y0, o.x1, o.y1, "ערכים מתחת לכותרת"));
            }
          }
        }
        if (found.includes(ADDRESSEE)) {
          let prev = line;
          for (const l of lines.slice(i + 1, i + 4)) {
            if (l.y0 - prev.y1 > 1.5 * Math.max(prev.h, l.h) || l.texts[0].length > 40) break;
            boxes.push(box(l.x0, l.y0, l.x1, l.y1, "כתובת למכתב"));
            prev = l;
          }
        }
      }
    });
    if (blockFrom !== null) boxes.push(box(0, blockFrom, width, height, "פרטים אישיים ובני משפחה"));
    state.inBlock = blockFrom !== null;
    boxes.push(...employerColumns(lines, width, height));
    let idFound = false;
    for (const it of items) {
      if (!String(it.str).trim()) continue;
      const hit = termHit(it.str, terms);
      if (hit && terms.id && String(it.str).replace(/\D/g, "").replace(/^0+/, "").includes(terms.id)) idFound = true;
      const why = hit || patternOf(it.str);
      if (why) boxes.push(box(it.x0, it.y0, it.x1, it.y1, why));
    }
    /* A value split over pieces ("0123" "45678", or a street and its house number) is caught on runs of pieces that
       sit close together, and only that run is blacked out, not the line. */
    for (const line of lines) {
      for (const run of runs(line)) {
        const ltr = run.slice().sort((a, b) => a.x0 - b.x0).map((it) => it.str);
        const rtl = ltr.slice().reverse();
        const [joined, joinedRtl] = [ltr.join(""), rtl.join("")];
        if (terms.id && [joined, joinedRtl].some((s) => s.replace(/\D/g, "").replace(/^0+/, "").includes(terms.id))) idFound = true;
        if (termHit(joined, terms) || termHit(joinedRtl, terms) || hasId(joined) || hasId(joinedRtl) || STREET.test(rtl.join(" "))) {
          boxes.push(box(Math.min(...run.map((o) => o.x0)), Math.min(...run.map((o) => o.y0)),
            Math.max(...run.map((o) => o.x1)), Math.max(...run.map((o) => o.y1)), "פרט מזהה בשורה"));
        }
      }
    }
    const text = items.map((it) => String(it.str)).join("").replace(/\s/g, "").length;
    return { boxes, labels, idFound, text };
  }

  /* Boxes of images, from the page's drawing commands (pdf.js operator list). ops: { fnArray, argsArray }, OPS: the
     pdf.js codes, base: the page transform from PDF space to top-left points. */
  function imageBoxes(ops, OPS, base) {
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    const IMAGE = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
      OPS.paintJpegXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask,
      OPS.paintImageMaskXObjectGroup, OPS.paintInlineImageXObjectGroup].filter((x) => x !== undefined));
    let m = base.slice();
    const stack = [];
    const out = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(m.slice());
      else if (fn === OPS.restore) m = stack.pop() || base.slice();
      else if (fn === OPS.transform) m = mul(m, args);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(m.slice()); if (args && args[0]) m = mul(m, args[0]); }
      else if (fn === OPS.paintFormXObjectEnd) m = stack.pop() || base.slice();
      else if (IMAGE.has(fn)) {
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        out.push(box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), "תמונה או קוד QR"));
      }
    }
    return out;
  }

  /* pages: [{ items, size, images }] for one or more files, in order. Returns per-page boxes and the verdict.
     options.doc "payslip": a payslip the template didn't recognise. Its labels are used, and nothing is refused:
     a page with no readable text gets no suggestion and is marked, so she blacks it out herself. */
  function decide(pages, input, options) {
    const payslip = !!(options && options.doc === "payslip");
    const labelList = payslip ? [...PAYSLIP_LABELS, ...LINE_LABELS] : LINE_LABELS;
    const terms = prepareTerms(input);
    const state = { inBlock: false };
    let labels = 0, idFound = false, scanned = 0;
    const result = pages.map((p, i) => {
      if (p.newFile) state.inBlock = false;
      const r = page(p.items, p.size, terms, state, labelList);
      labels += r.labels;
      idFound = idFound || r.idFound;
      const looksScanned = r.text < 20 && (p.images || []).some((b) => (b.x1 - b.x0) * (b.y1 - b.y0) > p.size.width * p.size.height * 0.4);
      if (looksScanned) scanned = scanned || i + 1;
      /* A scanned payslip page is one big picture: blacking out the picture would hide the whole page. */
      if (payslip && looksScanned) return { boxes: [], labels: 0, unreadable: true };
      return { boxes: [...r.boxes, ...(p.images || [])], labels: r.labels };
    });
    const typed = !!(terms.id || terms.words.length || terms.digits.length);
    if (payslip) return { pages: result, labels, refused: null, known: labels > 0, typed, idMissing: !!terms.id && !idFound };
    let refused = null;
    if (scanned) refused = { reason: "scanned", page: scanned };
    /* Typing the ID is optional. When she did type it and it isn't in the file, the file's text can't be read
       reliably, so the suggestion can't be trusted either. */
    else if (terms.id && !idFound) refused = { reason: "id-not-found" };
    return { pages: result, labels, refused, known: labels > 0, typed };
  }

  global.PensionBlank = { norm, validId, hasId, patternOf, prepareTerms, termHit, toLines, page, imageBoxes, decide };
})(window);
