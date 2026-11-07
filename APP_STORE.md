# Publishing Homework on the Mac App Store

The project is already set up to build a Mac App Store version (`npm run dist:mas`). The steps below are the parts only you can do, because they need your Apple account. Do them in order.

## 1. Join the Apple Developer Program

- Sign up at <https://developer.apple.com/programs/> ($99 a year). Approval can take a day or two.
- Once you're in, find your **Team ID**: developer.apple.com → Account → Membership details. It's 10 letters and numbers, like `A1B2C3D4E5`.

## 2. Put your Team ID in the project

Replace `TEAMID` with your Team ID in two places:

- `package.json` → `build.mas.extendInfo.ElectronTeamID`
- `build/entitlements.mas.plist` → the `TEAMID.com.reh8n.homework` line (it should become something like `A1B2C3D4E5.com.reh8n.homework`)

## 3. Create the certificates

The easiest way is in Xcode: **Xcode → Settings → Accounts**, sign in, select your team, click **Manage Certificates…**, then **+** and add both:

- **Apple Distribution**
- **Mac Installer Distribution**

They go into your keychain, and the build finds them there automatically.

## 4. Register the app ID and download a provisioning profile

At developer.apple.com → Certificates, Identifiers & Profiles:

1. **Identifiers → +** → App IDs → App. Bundle ID (explicit): `com.reh8n.homework`. Under Capabilities, tick **App Groups**. Register it.
2. **Profiles → +** → under Distribution choose **Mac App Store Connect**. Pick the `com.reh8n.homework` App ID and your Apple Distribution certificate.
3. Download the profile, rename it to `embedded.provisionprofile` and put it in the `build/` folder. Git ignores this file.

## 5. Build

```sh
npm run dist:mas
```

This checks steps 2 and 4 first and tells you what's missing. When it works, you get `dist/mas-arm64/Homework-<version>-arm64.pkg`.

**Test it before uploading.** Sandboxed apps behave differently. Make a **Mac App Development** profile the same way as in step 4, build with it, and confirm the Calendar tab, Reminders sync, notifications and "open at login" still work. The `calhelper` part is the riskiest, because it now runs inside the sandbox.

## 6. Create the listing in App Store Connect

At <https://appstoreconnect.apple.com> → Apps → **+** → New App:

- Platform: **macOS**. Name: Homework (the name has to be unique on the store, so you may need something like "Homework – School To-Do"). Bundle ID: `com.reh8n.homework`. SKU: anything, e.g. `homework-mac`.

Then fill in:

- **Screenshots**: at least one, at 1280×800, 1440×900, 2560×1600 or 2880×1800.
- **Description, keywords, support URL**.
- **Privacy Policy URL**: required. Homework keeps everything on the Mac and reads Calendar and Reminders. Say that the data isn't collected or sent anywhere.
- **App Privacy** questionnaire: "Data Not Collected" (true for the current code, which makes no network requests).
- **Age rating**, **price** (Free or paid), **category**: Education (already set in the build).
- **Review notes**: explain that Calendar and Reminders access is only used for the Calendar tab and for syncing tasks to a "Homework" Reminders list.

## 7. Upload and submit

1. Install **Transporter** from the Mac App Store, sign in, and drag in the `.pkg` from step 5.
2. After it finishes processing (about 15–60 minutes), select the build on your app's version page in App Store Connect.
3. Click **Add for Review**, then **Submit**.

For each later update, raise `version` in `package.json` before building. Apple rejects uploads that reuse a version number.

## Good to know

- **Apple Silicon only, macOS 14+.** The build is arm64-only and requires macOS 14 (the calendar helper needs it). Intel Macs won't see the app in the store.
- **Separate saved tasks.** The App Store version is sandboxed, so it saves tasks in its own container. It won't see tasks saved by the DMG version.
- **The DMG still works.** `npm run dist` builds the unsigned DMG for GitHub Releases, same as before.
