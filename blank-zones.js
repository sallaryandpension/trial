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

  /* read(rect) returns the RGBA pixels of a rect given in PDF points. */
  function identify(width, height, read) {
    for (const [name, t] of Object.entries(TEMPLATES)) {
      if (Math.abs(width - t.size[0]) > 2 || Math.abs(height - t.size[1]) > 2) continue;
      for (const side of ["front", "back"]) {
        if (t[side].anchors.every((a) => blueShare(read(a)) >= 0.3)) return { template: name, side, zones: t[side].zones };
      }
    }
    return null;
  }

  global.BlankZones = { TEMPLATES, identify, blueShare };
})(window);
