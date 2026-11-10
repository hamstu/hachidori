// Keeps Safari's background page, and the engine frame in it, loaded while a
// tab with the reader is shown.
//
// Safari unloads its non-persistent background page 30 seconds after the last
// event it handled, and with it the engine and every dictionary it has loaded,
// so the next lookup waits for them to load again. On iOS 18 neither an
// extension API call from the background page nor a message through an open
// port delays that; a runtime message from a content script does, and loads
// the page again if Safari has unloaded it. Each shown tab's top frame sends
// one every 20 seconds. Only the Safari build's manifest lists this script.
// SPDX-License-Identifier: GPL-3.0-or-later
(function () {
  if (window.top !== window) return;
  const PING_MS = 20_000;

  function ping() {
    if (document.visibilityState !== "visible") return;
    try {
      globalThis.chrome.runtime.sendMessage({ type: "safari-keepalive" }).catch(() => {});
    } catch {
      // The extension was reloaded; this copy of the script is stale.
    }
  }

  document.addEventListener("visibilitychange", ping);
  setInterval(ping, PING_MS);
  ping();
}());
