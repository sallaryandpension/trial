/* The only file that talks to the server. text/plain keeps the browser from sending a CORS preflight, which Apps
   Script can't answer, and the reply comes back after a redirect to Google's second address. */
(function (global) {
  "use strict";

  async function call(action, fields) {
    const response = await fetch(global.SITE.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action }, fields)),
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("http");
    return response.json();
  }

  global.Api = { call };
})(window);
