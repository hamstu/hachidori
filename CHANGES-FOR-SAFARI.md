# Hachidori for Safari on iOS and iPadOS

This fork (the `safari` branch) builds Hachidori as a Safari web extension for iPhone and iPad. It is based on
Hachidori's `main` at 9b928588 (2026-11-09) and was tested on an iPad Air (M1) running iPadOS 18.5, with the five
recommended dictionaries.

It follows the path that the Firefox build already takes: Safari, like Firefox, has no extension service worker,
offscreen documents, cross-origin isolation for extension pages or tab capture. The rest of this page lists what
Safari on iOS needed beyond that.

## Results

| | Before | After |
|---|---|---|
| Setup's dictionary install | Fails: "offscreen document sent no reply", then CORS errors | All five install; Jitendex in 3.9 s, JMnedict in 2.8 s |
| Lookup | Needs Shift and a mouse | A tap on a word |
| Tap after the page sat for 2–2.5 minutes | 442–586 ms (dictionaries loaded again) | 90–93 ms |
| Tap with the engine loaded | — | 93–96 ms |

Times are from the tap to the popup covering the page, measured on the device through Web Inspector.

## Building

`scripts/build-safari-app.py` writes `extension/` with the Safari manifest to `build/safari/extension`, wraps it in
an iOS app with Xcode's `safari-web-extension-converter`, builds it signed for development and, with `--install`,
installs it on a connected device:

```sh
python3 scripts/build-safari-app.py --team <development team ID> --bundle-id <your.bundle.id> \
    --install <device UDID from `xcrun devicectl list devices`>
```

Then open the app once, and turn the extension on in Settings → Apps → Safari → Extensions → Hachidori, with
**All Websites** set to **Allow**. Website access is needed for more than reading pages: without it, Safari applies
CORS to the extension's own downloads, and the recommended dictionaries cannot be installed.

The converter, in `--ios-only` mode, names the app after `--app-name` but gives the extension the given bundle
identifier's prefix, which iOS rejects ("Embedded binary's bundle identifier is not prefixed with the parent app's
bundle identifier"). The script sets both identifiers from `--bundle-id`.

## Manifest (`scripts/safari_manifest.py`)

Derived from the Chrome manifest, as `scripts/firefox_manifest.py` derives Firefox's:

- **Background page:** `background.html`, as in the Firefox build, which runs `background.js` and holds the engine
  document (`offscreen.html`) in a frame. iOS needs it to be non-persistent (`"persistent": false`).
- **Left out:** the `offscreen`, `tabCapture`, `userScripts` and `downloads` permissions, the optional
  `clipboardRead` permission, and `minimum_chrome_version` and the cross-origin isolation keys.
- **Web-accessible resources:** the search page's sandboxed-frame resources that Firefox also needs.
- **Content scripts:** adds `safari-keepalive.js` (see [Keeping the dictionaries loaded](#keeping-the-dictionaries-loaded)).

Without cross-origin isolation, `offscreen.js` already picks the single-thread engine in a worker, on IndexedDB
(`worker-local`). That is what Safari on iOS needs anyway: it gives the extension a new origin each launch, and only
IndexedDB and local storage are carried over, so files in the origin private file system would be lost.

## Messages between the background page and the engine frame (`extension/browser-api.js`)

**Problem:** Safari does not deliver `runtime.sendMessage` to another document of the page that sent it. The
background page relays every engine request to `offscreen.html` in its frame with `runtime.sendMessage`, as in
Firefox, and the frame never received them; setup failed with "Could not start dictionary installation: offscreen
document sent no reply". The frame's own requests to `background.js` were lost the same way.

**Fix:** in Safari's `background.html` and its frame only, `selectExtensionApi()` wraps `runtime.sendMessage` and
`runtime.onMessage`. A message is delivered to the other document's listeners directly, with the sender a runtime
message would carry (the extension's ID and the sending document's URL, no tab), so the existing sender checks still
apply. It is also sent through the runtime as before, for every other extension page, and the first reply from
either answers.

## Dictionary downloads (`extension/offscreen.js`, `extension/engine-service.js`)

**Problem:** Safari exempts an extension's documents from CORS for the sites it may access, but not their workers.
The engine downloads a dictionary archive in its worker, where every recommended dictionary failed: "Cross-origin
redirection to https://github.com/… denied by Cross-Origin Resource Sharing policy", and for Jiten's frequency list
"Origin safari-web-extension://… is not allowed by Access-Control-Allow-Origin". The same `fetch` from the engine's
document succeeded.

**Fix:** on Safari, `offscreen.js` downloads a remote archive in the document before passing the import to the
worker, and adds `downloadedArchive: { blobUrl, finalUrl }` to the request. The worker reads the archive from the
Blob URL. `archiveUrl` is unchanged, so the import's source validation is unchanged, and the engine checks
`finalUrl`, the URL the document's download ended at, against the dictionary's source as it checks its own
download's. The Blob URL is revoked when the import finishes.

## Tap to look up (`extension/content.js`)

**Problem:** the reader scans with the mouse: hovering with an activation key held (Shift by default), or hovering
with no key. A touch screen has neither hover nor keys, so nothing could be looked up.

**Fix:** a tap looks up the word under it, whatever Reading → Activation says, and works in every browser with touch
input. Mouse, pen and trackpad behave as before.

- A tap is a touch pointer that is released within 500 ms and has moved less than 10 px; a scroll, a drag or a long
  press (iOS's text selection) doesn't look up.
- A tap away from text and the popup closes the popup.
- Taps in the popup are the popup's own: a word in its definitions opens a child popup, as when Child popups is set
  to Click, and links and buttons keep their actions.
- iOS follows a tap with emulated mouse events at the same point. The reader ignores mouse events for one second
  after a touch: an emulated move without the activation key would hide the popup the tap had opened, and an emulated
  press on text would start a selection drag.

## Keeping the dictionaries loaded (`extension/safari-keepalive.js`)

**Problem:** Safari unloads a non-persistent background page 30 seconds after the last event it handled, and the
engine frame and every dictionary it has loaded with it. The next tap waited for them to load again: 442–586 ms
instead of about 90 ms. Safari's log on the device shows each step: "Scheduling background content to unload in 30
seconds", then "Unloading non-persistent background content".

What did not delay it on iOS 18.5, each checked against that log:

- the Firefox build's keep-alive, an extension API call (`runtime.getPlatformInfo()`) every 20 seconds;
- the background page posting to ports that tabs hold open, which OwOtan uses;
- tabs posting through those ports to the background page. Safari also closes the ports when it unloads the page
  without the tabs' ends being told, so they could not tell when to reconnect.

A `runtime.sendMessage` from a content script does delay it, and loads the page again if Safari has unloaded it.

**Fix:** `safari-keepalive.js`, a content script in the Safari manifest only, sends one from each tab's top frame
every 20 seconds while the tab is shown. The background page then stayed loaded for over 5 minutes without a lookup,
and taps after 2–2.5 minutes took 90–93 ms. While Safari shows no tab with the reader, as when another app is in
front, nothing keeps it loaded, and the first tap after takes about 0.5 s again.

## Not done yet

- **Anki:** AnkiConnect cannot be reached from iOS. OwOtan adds notes by opening AnkiMobile's `addnote` link, which
  could be done here too. Anki mining is untested.
- **Pronunciation audio:** untested; Safari needs a gesture before a page plays audio.
- **Website access:** setup does not detect that Hachidori has not been allowed on every website, which makes the
  downloads fail with CORS errors.
- **Netflix and YouTube mining:** without tab capture, notes get no line audio or GIF, as in Firefox.
- **Packaging:** `scripts/package-store.py` does not know about `safari-keepalive.js`, so the Chrome and Firefox ZIPs
  would include it (unused, as their manifests don't list it).
- **Tests:** none of the changes have tests of their own yet. The node suite gives the same results with and without
  them (1,246 pass; three language suites fail in this environment on `main` too).
