/* The teacher's own black boxes, used on both blanking pages after our automatic step. A box is kept as fractions of
   the page ({ x, y, w, h }), drawn over the page while she looks, and burnt into the image before the file is built. */
(function (global) {
  "use strict";

  function place(el, m) {
    el.style.left = `${m.x * 100}%`;
    el.style.top = `${m.y * 100}%`;
    el.style.width = `${m.w * 100}%`;
    el.style.height = `${m.h * 100}%`;
  }

  /* wrap: the element around the page image. marks: that page's list, filled here. active(): whether marking is on.
     onAdd(el, mark) is called for every finished box. */
  function attach(wrap, marks, active, onAdd) {
    let start = null, el = null;
    const at = (e) => {
      const r = wrap.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    };
    const rect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    wrap.addEventListener("pointerdown", (e) => {
      if (!active()) return;
      e.preventDefault();
      wrap.setPointerCapture(e.pointerId);
      start = at(e);
      el = document.createElement("div");
      el.className = "mark";
      place(el, rect(start, start));
      wrap.append(el);
    });
    wrap.addEventListener("pointermove", (e) => { if (start) place(el, rect(start, at(e))); });
    const end = (e) => {
      if (!start) return;
      const m = rect(start, at(e));
      start = null;
      if (m.w < 0.005 || m.h < 0.003) { el.remove(); return; }
      const pad = 0.003;   // a little beyond what she drew
      const mark = { x: Math.max(0, m.x - pad), y: Math.max(0, m.y - pad), w: Math.min(1, m.w + 2 * pad), h: Math.min(1, m.h + 2 * pad) };
      place(el, mark);
      marks.push(mark);
      onAdd(el, mark);
    };
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
  }

  /* Draws an image, then boxes in pixels (fill(ctx, scale)) and her marks, and returns a new JPEG. */
  async function burn(image, pixelWidth, pixelHeight, marks, fill) {
    const bitmap = await global.createImageBitmap(image);
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    ctx.fillStyle = "#000000";
    if (fill) fill(ctx);
    ctx.fillStyle = "#000000";
    for (const m of marks) ctx.fillRect(m.x * canvas.width, m.y * canvas.height, m.w * canvas.width, m.h * canvas.height);
    const jpeg = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image"))), "image/jpeg", 0.9));
    canvas.width = canvas.height = 0;
    return jpeg;
  }

  global.Marks = { attach, burn, place };
})(window);
