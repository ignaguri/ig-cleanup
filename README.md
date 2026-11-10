# Instagram Cleanup

Chrome extension to swipe through the accounts you follow and decide who stays: keep, unfollow, remove as a follower, or both. Works with the keyboard or voice.

## Installation

### From a Release (recommended)

1. Download `instagram-cleanup-vX.Y.Z.zip` from the [latest release](https://github.com/ignaguri/ig-cleanup/releases/latest)
2. Unzip the file
3. Open `chrome://extensions/` in Chrome
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** and select the unzipped folder
6. Log into instagram.com, then click the extension icon to open the deck

To update, unzip the new version over the old folder and click reload (↻) on the extension card. Your scans and decisions are kept.

### From Source

```bash
git clone https://github.com/ignaguri/ig-cleanup
cd ig-cleanup
npm install
npm run build        # builds to dist/
```

Then load unpacked from `dist/`.

## Releasing

1. Bump `version` in `static/manifest.json` (and `package.json`) and commit
2. Tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`

The Release workflow builds the extension and attaches the zip to a GitHub Release. It fails if the tag doesn't match the manifest version.
