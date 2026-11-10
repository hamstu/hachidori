"""The Safari build's manifest, derived from the Chrome manifest in extension/manifest.json.

Safari, like Firefox, has no offscreen documents, cross-origin isolation for
extension pages, tab capture or user scripts, so the Safari build runs the
background page that the Firefox build does (background.html), which holds the
engine document in a frame. Without cross-origin isolation the engine is the
single-thread build in a worker, on IndexedDB: Safari on iOS gives the
extension a new origin each launch, and only IndexedDB and local storage are
carried over to it. iOS also needs the background page to be non-persistent.

Safari has no downloads API or clipboardRead permission either. It checks the
files that an extension page loads in a website's frame against
web_accessible_resources, as Firefox does for the search page's sandboxed
frame, so those resources are listed for it too.
"""

import copy

from firefox_manifest import CHROME_BACKGROUND, CHROME_ONLY_KEYS, SANDBOX_RESOURCES

SAFARI_ONLY_FILES = ("background.html", "event-page.js", "safari-keepalive.js")
UNSUPPORTED_PERMISSIONS = ("offscreen", "tabCapture", "userScripts", "downloads")
UNSUPPORTED_OPTIONAL_PERMISSIONS = ("clipboardRead",)


def safari_manifest(chrome):
    if chrome.get("background") != CHROME_BACKGROUND:
        raise ValueError(f"background.html runs {CHROME_BACKGROUND}; update it for {chrome.get('background')}")
    manifest = copy.deepcopy(chrome)
    for key in CHROME_ONLY_KEYS:
        manifest.pop(key, None)
    manifest["background"] = {"page": "background.html", "persistent": False}
    manifest["permissions"] = [permission for permission in chrome["permissions"]
                               if permission not in UNSUPPORTED_PERMISSIONS]
    optional = [permission for permission in chrome.get("optional_permissions", [])
                if permission not in UNSUPPORTED_OPTIONAL_PERMISSIONS]
    if optional:
        manifest["optional_permissions"] = optional
    else:
        manifest.pop("optional_permissions", None)
    # Safari unloads the background page, and the dictionaries the engine has
    # loaded, 30 seconds after the last event it handled; safari-keepalive.js
    # sends it a message from each shown tab.
    manifest["content_scripts"][0]["js"] = [*manifest["content_scripts"][0]["js"], "safari-keepalive.js"]
    manifest["web_accessible_resources"] = [*manifest["web_accessible_resources"],
                                            {"resources": list(SANDBOX_RESOURCES), "matches": ["<all_urls>"]}]
    return manifest
