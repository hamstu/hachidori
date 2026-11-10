#!/usr/bin/env python3
"""Build the Safari app for iOS and iPadOS, which Safari loads the extension from.

Writes the working tree's extension/ with the Safari manifest to
<output>/extension, wraps it in an app with Xcode's Safari web extension
converter at <output>/app, and builds the app signed for development by the
team given with --team. With --install, the app is installed on that device
(a UDID from `xcrun devicectl list devices`).

Needs macOS with Xcode. A device installs only apps signed by a development
team that it has been registered with, which automatic signing does.
"""

import argparse
import json
import re
from pathlib import Path
import shutil
import subprocess

from safari_manifest import safari_manifest

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
APP_NAME = "Hachidori"


def run(*command):
    subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "build" / "safari",
                        help="Directory to write the extension, the Xcode project and the build to")
    parser.add_argument("--team", required=True, help="Apple development team ID to sign with")
    parser.add_argument("--bundle-id", required=True, help="Bundle identifier of the app, such as com.example.hachidori")
    parser.add_argument("--install", metavar="UDID", help="Install the app on this device after building it")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if output.is_relative_to(EXTENSION) or EXTENSION.is_relative_to(output):
        parser.error("Choose an output directory outside extension/.")

    extension = output / "extension"
    app = output / "app"
    shutil.rmtree(output, ignore_errors=True)
    shutil.copytree(EXTENSION, extension)
    manifest = safari_manifest(json.loads((EXTENSION / "manifest.json").read_text()))
    (extension / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    run("xcrun", "safari-web-extension-converter", "--project-location", str(app), "--app-name", APP_NAME,
        "--bundle-identifier", args.bundle_id, "--swift", "--ios-only", "--copy-resources", "--no-open",
        "--no-prompt", "--force", str(extension))
    project = next((app / APP_NAME).glob("*.xcodeproj"))
    # With --ios-only, the converter names the app after --app-name rather than
    # --bundle-identifier, while the extension keeps the given prefix, which iOS
    # rejects: an extension's identifier must start with its app's.
    for project_file in project.glob("project.*"):
        if project_file.suffix not in (".xcproj", ".pbxproj"):
            continue
        text = project_file.read_text()
        text = re.sub(r'(PRODUCT_BUNDLE_IDENTIFIER"?\s*[:=]\s*"?)([^";,\n]+)',
                      lambda match: match.group(1) + (f"{args.bundle_id}.Extension"
                                                      if match.group(2).endswith(".Extension") else args.bundle_id),
                      text)
        project_file.write_text(text)
    derived = output / "DerivedData"
    run("xcodebuild", "-project", str(project), "-scheme", APP_NAME, "-configuration", "Release",
        "-destination", "generic/platform=iOS", "-derivedDataPath", str(derived), "-allowProvisioningUpdates",
        "CODE_SIGN_STYLE=Automatic", f"DEVELOPMENT_TEAM={args.team}", "build")
    product = derived / "Build" / "Products" / "Release-iphoneos" / f"{APP_NAME}.app"
    print(product)
    if args.install:
        run("xcrun", "devicectl", "device", "install", "app", "--device", args.install, str(product))


if __name__ == "__main__":
    main()
