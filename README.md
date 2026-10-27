# Homework

A minimal school to-do list for macOS. Add your homework with a due date, get a reminder the evening before, and tick it off when it's done.

- Ticked tasks fold out of the list and move to **Done** straight away. Untick one in Done to bring it back.
- A "due tomorrow" reminder at 7pm. If your Mac was asleep and missed it, you get a catch-up reminder after 7am, never in the middle of the night.
- Lives in the menu bar.

## Install

Requires a Mac with Apple Silicon (M1 or later). Intel Macs aren't supported.

1. Download `Homework-<version>-arm64.dmg` from [Releases](../../releases).
2. Open the DMG and drag **Homework** into **Applications**.
3. The app isn't signed with an Apple Developer certificate, so the first time macOS will say it's from an unidentified developer. To open it anyway:
   - In Applications, **right-click Homework → Open**, then click **Open** again.
   - If there's no Open button (newer macOS), go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to Homework.

You only have to do this once.

## Build from source

You need [Node.js](https://nodejs.org) 18 or later.

```sh
npm install     # install dependencies
npm start       # run the app in development
npm run dist    # build dist/Homework-<version>-arm64.dmg
```

## License

[MIT](LICENSE)
