/* Divides a long file into parts for sending, and picks the pages the teacher looks at. A payslip is never cut. */
(function (global) {
  "use strict";
  const MAX_SLIPS = 20;
  const MAX_BYTES = 15 * 1024 * 1024; // To be settled by probe.html against the real server.
  const SAMPLE_ALL_UP_TO = 40;        // Up to this many pages she sees every page.
  const SAMPLE_EVERY = 24;            // About one year of front and back pages.

  /* pages: [{ side: "front" | "back", newFile?, ... }]. A front after a back opens a new payslip. Two fronts in a row
     belong to one payslip, and a month with no back page simply ends at the next front that follows a back. The first
     page of every file after the first opens a new payslip too: a payslip never spans two files. */
  function slips(pages) {
    const out = [];
    let current = null;
    let last = null;
    pages.forEach((page, index) => {
      if (!current || page.newFile || (page.side === "front" && last === "back")) {
        current = [];
        out.push(current);
      }
      current.push(index);
      last = page.side;
    });
    return out;
  }

  /* pages also carry size in bytes. Returns a list of parts, each a list of page indexes in order. */
  function parts(pages, limits) {
    const maxSlips = (limits && limits.maxSlips) || MAX_SLIPS;
    const maxBytes = (limits && limits.maxBytes) || MAX_BYTES;
    const out = [];
    let part = [];
    let count = 0;
    let bytes = 0;
    for (const slip of slips(pages)) {
      const size = slip.reduce((sum, i) => sum + pages[i].size, 0);
      if (part.length && (count + 1 > maxSlips || bytes + size > maxBytes)) {
        out.push(part);
        part = [];
        count = 0;
        bytes = 0;
      }
      part.push(...slip);
      count += 1;
      bytes += size;
    }
    if (part.length) out.push(part);
    return out;
  }

  /* The blanked file has no readable date, so samples are spread by position: every page of the first payslip, and
     the same again about once a year. The rest are shown on request. */
  function samples(pages) {
    if (pages.length <= SAMPLE_ALL_UP_TO) return pages.map((_, i) => i);
    const list = slips(pages);
    const out = [];
    let next = 0;
    let seen = 0;
    for (const slip of list) {
      if (seen >= next) {
        out.push(...slip);
        next = seen + SAMPLE_EVERY;
      }
      seen += slip.length;
    }
    return out;
  }

  global.Split = { slips, parts, samples };
})(window);
