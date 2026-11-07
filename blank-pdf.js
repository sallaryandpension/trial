/* Builds a new PDF from JPEG images only. Nothing from the original file is copied, so no text, shapes,
   metadata or hidden layers can survive. */
(function (global) {
  "use strict";
  const encoder = new TextEncoder();
  const sizeOf = (x) => (x.size === undefined ? x.length : x.size);

  /* pages: [{ jpeg, pixelWidth, pixelHeight, width, height }], with width and height in points.
     jpeg may be a Uint8Array or a Blob. Returns the pieces of the file and their total length. */
  function assemble(pages) {
    const parts = [];
    let length = 0;
    const add = (x) => {
      const piece = typeof x === "string" ? encoder.encode(x) : x;
      parts.push(piece);
      length += sizeOf(piece);
    };
    const offsets = [];
    const object = (id, head, stream) => {
      offsets[id] = length;
      add(`${id} 0 obj\n${head}\n`);
      if (stream) { add("stream\n"); add(stream); add("\nendstream\n"); }
      add("endobj\n");
    };
    add("%PDF-1.4\n");
    const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`);
    pages.forEach((p, i) => {
      const page = 3 + i * 3, image = page + 1, content = page + 2;
      object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Resources << /XObject << /I ${image} 0 R >> >> /Contents ${content} 0 R >>`);
      object(image, `<< /Type /XObject /Subtype /Image /Width ${p.pixelWidth} /Height ${p.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${sizeOf(p.jpeg)} >>`, p.jpeg);
      const draw = encoder.encode(`q ${p.width} 0 0 ${p.height} 0 0 cm /I Do Q`);
      object(content, `<< /Length ${draw.length} >>`, draw);
    });
    const count = 3 + pages.length * 3;
    const xref = length;
    add(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let id = 1; id < count; id++) add(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return parts;
  }

  /* A Blob, so a long file doesn't have to fit in one array in memory. */
  function build(pages) {
    return new Blob(assemble(pages), { type: "application/pdf" });
  }

  global.BlankPdf = { build };
})(window);
