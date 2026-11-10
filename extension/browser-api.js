// Browser API and extension-origin facts shared by module contexts.
// Content scripts intentionally keep their callback-style `chrome` calls.
// SPDX-License-Identifier: GPL-3.0-or-later

export function selectExtensionApi(scope = globalThis) {
  const api = scope.chrome ?? null;
  return api && safariBackgroundContext(api, scope) ? withSamePageMessages(api, scope) : api;
}

// Safari's background page, background.html, holds the engine document in a
// frame as Firefox's does, but Safari does not deliver runtime.sendMessage to
// another document of the page that sent it: the relay to offscreen.html and
// its requests back to background.js would never be answered. The two
// documents therefore deliver messages to each other's listeners themselves,
// with the sender a runtime message would carry, and send everything else
// through the runtime as before.
function safariBackgroundContext(api, scope) {
  if (api.runtime?.getURL?.("").startsWith("safari-web-extension:") !== true) return false;
  const background = api.runtime.getURL("background.html");
  try {
    return scope.location?.href === background || (scope.parent !== scope && scope.parent.location.href === background);
  } catch {
    return false;
  }
}

function withSamePageMessages(api, scope) {
  const page = scope.parent === scope ? scope : scope.parent;
  page.hdSamePageListeners ??= { background: new Set(), frame: new Set() };
  const own = page.hdSamePageListeners[scope === page ? "background" : "frame"];
  const other = page.hdSamePageListeners[scope === page ? "frame" : "background"];
  const runtime = api.runtime;
  const sender = () => ({ id: runtime.id, url: scope.location.href, origin: scope.location.origin });
  const onMessage = {
    addListener(listener) { own.add(listener); runtime.onMessage.addListener(listener); },
    removeListener(listener) { own.delete(listener); runtime.onMessage.removeListener(listener); },
    hasListener(listener) { return own.has(listener); },
  };
  // The first reply from either document or the runtime answers; with neither,
  // the runtime's own result or error does.
  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      let waiting = 2;
      let remoteError = null;
      const finished = () => {
        waiting -= 1;
        if (waiting > 0) return;
        if (remoteError) reject(remoteError);
        else resolve(undefined);
      };
      deliver(other, structuredClone(message), sender()).then(reply => {
        if (reply !== undefined) resolve(structuredClone(reply));
        else finished();
      });
      Promise.resolve(runtime.sendMessage(message)).then(reply => {
        if (reply !== undefined) resolve(reply);
        else finished();
      }, error => {
        remoteError = error;
        finished();
      });
    });
  }
  const wrappedRuntime = new Proxy(runtime, {
    get(target, key) {
      if (key === "onMessage") return onMessage;
      if (key === "sendMessage") return sendMessage;
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(api, { get: (target, key) => (key === "runtime" ? wrappedRuntime : target[key]) });
}

// Calls listeners as the runtime does: the first response wins, whether it
// is passed to sendResponse after returning true or returned as a promise.
function deliver(listeners, message, sender) {
  return new Promise(resolve => {
    let waiting = 0;
    let settled = false;
    const settle = value => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    for (const listener of [...listeners]) {
      let result;
      try {
        result = listener(message, sender, settle);
      } catch {
        continue;
      }
      if (result === true) {
        waiting += 1;
      } else if (typeof result?.then === "function") {
        waiting += 1;
        result.then(value => {
          if (value !== undefined) settle(value);
          else if (--waiting === 0) settle(undefined);
        }, () => { if (--waiting === 0) settle(undefined); });
      }
    }
    if (waiting === 0) settle(undefined);
  });
}

export const extensionApi = selectExtensionApi();

export function extensionDocumentUrl(path, api = extensionApi) {
  return api?.runtime?.getURL?.(path) ?? path;
}

// Chrome runs background.js as the service worker; Firefox runs it in the
// background page that the Firefox build's manifest names, and reports that
// page as an absolute URL.
export function expectedBackgroundUrl(api = extensionApi) {
  const background = api?.runtime?.getManifest?.()?.background;
  const script = background?.service_worker || background?.page || "background.js";
  return URL.canParse(script) ? script : extensionDocumentUrl(script, api);
}

// Firefox serves extension documents from moz-extension:// URLs; Chrome and the
// Electron overlay host from chrome-extension:// URLs.
export function isFirefox(api = extensionApi) {
  return api?.runtime?.getURL?.("").startsWith("moz-extension:") === true;
}

// Safari serves them from safari-web-extension:// URLs.
export function isSafari(api = extensionApi) {
  return api?.runtime?.getURL?.("").startsWith("safari-web-extension:") === true;
}

export function isExactExtensionSender(sender, path, api = extensionApi, { tab = null } = {}) {
  if (sender?.id !== api?.runtime?.id || sender?.url !== extensionDocumentUrl(path, api)) return false;
  if (tab === false && sender.tab !== undefined) return false;
  if (tab === true && sender.tab === undefined) return false;
  return true;
}
