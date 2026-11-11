/* Areas blanked on a payslip, in PDF points from the top left, as [x0, y0, x1, y1].
   Template "print": the Ministry payslip saved with Microsoft Print To PDF, 612 x 792.
   A page is accepted only if its anchors (dark blue section headings) are where the template expects them.
   Any other page is refused, because a blank box in the wrong place would leave details visible. */
(function (global) {
  "use strict";
  const TEMPLATES = {
    print: {
      size: [612, 792],
      front: {
        anchors: [[478, 204, 558, 215], [354, 204, 412, 215]],
        zones: [
          ["כתובת, שם ומוסד", [340, 50, 570, 102]],
          ["פקיד שכר", [40, 76, 168, 100]],
          ["קוד QR", [34, 150, 100, 214]],
          ["קוד אנכי", [10, 300, 32, 396]],
          ["מספר זהות, שם ובנק", [438, 217, 512, 284]],
          ["תאריך תחילת עבודה", [452, 342, 504, 357]],
          ["מצב משפחתי ונקודות זיכוי", [438, 380, 512, 429]],
          ["מספרי חשבון בקופות", [232, 492, 277, 610]],
          ["ניכויים אחרים", [34, 642, 414, 772]],
        ],
      },
      back: {
        anchors: [[450, 20, 532, 31], [146, 20, 201, 31]],
        zones: [
          ["מוסדות במשרות", [374, 56, 504, 206]],
          ["מוסדות בתפקידים", [164, 48, 196, 84]],
          ["מילוי מקום: מוסד ועובד", [138, 112, 202, 192]],
          ["היעדרויות: תיאור ומוסד", [212, 240, 382, 320]],
          ["היעדרויות: מוסד", [504, 240, 534, 320]],
          ["הודעות חופשיות", [8, 504, 534, 736]],
          ["שורת שם ומספר זהות", [66, 756, 292, 776]],
        ],
      },
    },
  };

  /* Share of dark blue pixels, as in the section heading pills. */
  function blueShare(data) {
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (b > r + 40 && r < 110 && b > 80) blue += 1;
    }
    return blue / (data.length / 4);
  }

  /* Blue share of any rect in constant time, from one pass over the page: a summed-area table of blue pixels.
     data: RGBA of the whole page at `scale` pixels per point. */
  function blueMap(data, w, h, scale) {
    const sum = new Uint32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (b > r + 40 && r < 110 && b > 80) row += 1;
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
      }
    }
    return function share([x0, y0, x1, y1]) {
      const a = Math.max(0, Math.round(x0 * scale)), b = Math.max(0, Math.round(y0 * scale));
      const c = Math.min(w, Math.round(x1 * scale)), d = Math.min(h, Math.round(y1 * scale));
      if (c <= a || d <= b) return 0;
      const n = sum[d * (w + 1) + c] - sum[b * (w + 1) + c] - sum[d * (w + 1) + a] + sum[b * (w + 1) + a];
      return n / ((c - a) * (d - b));
    };
  }

  /* A page of another size, such as the portal's own file (595 x 840; the print is the same layout on a wider page,
     web/README.md): the side comes from the text layer, and the template's position is found by sliding its anchors
     over the page. It counts only as one clear match, with the other side's anchors absent at that place. The zones
     then move with it, a little larger to cover the measuring error. */
  const SHIFT_X = 24, SHIFT_Y_UP = 16, SHIFT_Y_DOWN = 56, PAD = 4;
  const move = ([x0, y0, x1, y1], dx, dy, pad) => [x0 + dx - pad, y0 + dy - pad, x1 + dx + pad, y1 + dy + pad];

  function calibrate(width, height, share, side) {
    for (const [name, t] of Object.entries(TEMPLATES)) {
      if (Math.abs(width - t.size[0]) > 40 || height < t.size[1] - 20 || height > t.size[1] + 90) continue;
      const other = t[side === "front" ? "back" : "front"];
      const cols = 2 * SHIFT_X + 1;
      const scores = [];
      for (let dy = -SHIFT_Y_UP; dy <= SHIFT_Y_DOWN; dy++) {
        for (let dx = -SHIFT_X; dx <= SHIFT_X; dx++) {
          scores.push({ dx, dy, s: Math.min(...t[side].anchors.map((a) => share(move(a, dx, dy, 0)))) });
        }
      }
      const at = (dx, dy) => {
        if (Math.abs(dx) > SHIFT_X || dy < -SHIFT_Y_UP || dy > SHIFT_Y_DOWN) return 0;
        return scores[(dy + SHIFT_Y_UP) * cols + dx + SHIFT_X].s;
      };
      const best = scores.reduce((m, p) => (p.s > m.s ? p : m), { s: 0 });
      if (best.s < 0.8) continue;
      /* The anchors may sit inside wider blue headings, so the best is a plateau: its middle is taken, and the zones
         grow by half its size, the error that is left. A plateau too wide to place the zones is not trusted. */
      const top = scores.filter((p) => p.s >= best.s - 0.03);
      const spanX = Math.max(...top.map((p) => p.dx)) - Math.min(...top.map((p) => p.dx));
      const spanY = Math.max(...top.map((p) => p.dy)) - Math.min(...top.map((p) => p.dy));
      if (spanX > 16 || spanY > 16) continue;
      const dx = top.reduce((s, p) => s + p.dx, 0) / top.length, dy = top.reduce((s, p) => s + p.dy, 0) / top.length;
      /* A second peak elsewhere means another place could fit as well, so the page is not trusted. Sliding off the
         same heading only lowers the score step by step, and is no peak. */
      const second = scores.some((p) => p.s >= 0.6 && (Math.abs(p.dx - dx) > spanX / 2 + 4 || Math.abs(p.dy - dy) > spanY / 2 + 4)
        && [-1, 0, 1].every((i) => [-1, 0, 1].every((j) => (!i && !j) || at(p.dx + i, p.dy + j) <= p.s)));
      if (second) continue;
      if (other.anchors.some((a) => share(move(a, dx, dy, 0)) >= 0.3)) continue;
      const pad = PAD + Math.max(spanX, spanY) / 2;
      return { template: name, side, zones: t[side].zones.map(([label, z]) => [label, move(z, dx, dy, pad)]), shift: [dx, dy] };
    }
    return null;
  }

  /* read(rect) returns the RGBA pixels of a rect given in PDF points. options: { share, side } for a page of another
     size, where share is blueMap's function and side comes from the page's text ("front", "back" or null). */
  function identify(width, height, read, options) {
    for (const [name, t] of Object.entries(TEMPLATES)) {
      if (Math.abs(width - t.size[0]) > 2 || Math.abs(height - t.size[1]) > 2) continue;
      for (const side of ["front", "back"]) {
        if (t[side].anchors.every((a) => blueShare(read(a)) >= 0.3)) return { template: name, side, zones: t[side].zones };
      }
    }
    if (options && options.share && options.side) return calibrate(width, height, options.share, options.side);
    return null;
  }

  /* The side of a portal page, from its text: only the back carries "תלוש משכורת לחודש". No text, no answer. */
  const BACK_WORDS = ["תלוש", "משכורת", "לחודש"];
  function sideFromText(strings) {
    const words = new Set();
    for (const s of strings) {
      for (const w of String(s).split(/\s+/)) {
        if (!w) continue;
        words.add(w);
        words.add([...w].reverse().join(""));
      }
    }
    if (!strings.join("").replace(/\s/g, "").length) return null;
    return BACK_WORDS.every((w) => words.has(w)) ? "back" : "front";
  }

  global.BlankZones = { TEMPLATES, identify, blueShare, blueMap, calibrate, sideFromText };
})(window);
