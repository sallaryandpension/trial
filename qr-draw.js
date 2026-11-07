/* Draws a QR code on a canvas. The strict page rules forbid the inline styles of the library's own output. */
(function (global) {
  "use strict";
  const CELL = 4;
  const QUIET = 4;

  function draw(canvas, text) {
    const qr = global.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    canvas.width = canvas.height = (size + QUIET * 2) * CELL;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.isDark(row, col)) ctx.fillRect((col + QUIET) * CELL, (row + QUIET) * CELL, CELL, CELL);
      }
    }
  }

  global.QrDraw = { draw };
})(window);
