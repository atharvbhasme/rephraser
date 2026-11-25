# Setup guide

This guide sets up Rephraser on your computer step by step. Copy each command into a terminal.

- **Spelling & Grammar** works right after step 3. It needs no AI model and no internet.
- **Rephrase** is optional (step 4). It needs a one-time download of about 250 MB. The system check in step 4a tells you first whether your computer can run it, so you don't waste time downloading something that won't work.

---

## 1. What you need

| | Minimum | Recommended |
|---|---|---|
| Node.js | 18 | 20 or newer ([nodejs.org](https://nodejs.org)) |
| Browser | Chrome/Edge 91+, Firefox 89+, Safari 16.4+ | latest Chrome, Edge or Firefox |
| Disk space | ~350 MB (app only) | ~600 MB (with Rephrase) |
| For Rephrase | 4 GB RAM, 2 CPU threads | 8 GB RAM, 4+ CPU threads |

An Intel i3 (7th gen) laptop with 8 GB RAM runs both features.

To check your Node.js version:

```bash
node --version
```

## 2. Install

Open a terminal in the project folder and run:

```bash
npm install
```

This takes about a minute and installs everything the app needs.

## 3. Start the app

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

The **✓ Spelling & Grammar** tab now works. Type or paste text, and mistakes are underlined as you type. The corrected text appears on the right. You can edit it there before you click **Copy**. From here on it works without the internet.

**Stop names and technical terms being flagged:**
- Click **+ Add to dictionary** next to a flagged word, for example a name like "Bhasme" or a term like "kubectl". It is never flagged again.
- Click **📖 Dictionary** at the top to add many words at once, remove words, or import/export your list as a `.txt` file.
- In the same window, turn on the built-in word packs: **Indian names & places** and **Tech terms**.
- Your dictionary is saved in this browser. Use **Export .txt** to move it to another browser or computer.

To stop the app, press `Ctrl + C` in the terminal.

## 4. (Optional) Turn on Rephrase

### 4a. Check that your computer can run it

```bash
npm run check:system
```

This takes a few seconds and downloads nothing. It checks RAM, free disk space, CPU and speed, then gives you a verdict:

- **✅ Supported** — go to step 4b.
- **⚠️ Supported, may be slow** — it will work. The ⚠ lines tell you what to improve, for example closing other apps.
- **❌ Not supported** — skip Rephrase. Spelling & Grammar still works normally.

The check also estimates how long one sentence will take on your computer.

### 4b. Download the model (one time only)

```bash
npm run setup:rephrase
```

This command does the following:

1. Runs the system check again. If the verdict is ❌, it stops and downloads nothing.
2. Shows what it will download (about 250 MB) and how long that should take, then asks you to confirm.
3. Downloads the files with a progress bar showing percentage, speed and time left.
4. Checks every file against its published checksum.

If the download is interrupted, run the same command again. It continues where it stopped.

**This is the only step that uses the internet.**

### 4c. Use it

Refresh the browser and open the **↻ Rephrase** tab.

1. A **device check** card shows whether this browser can run Rephrase.
2. Paste your text. Before you start, it shows the **estimated time**, for example "≈ 6 s (~1 s per sentence) + ~4 s one-time model load".
3. Click **↻ Rephrase**. A status line shows each step as it happens: loading the model, preparing it for your CPU, warming up, then "Rephrasing sentence 2 of 5 · 3 s elapsed · ~4 s left".
4. Click any sentence in the result to see other versions of it.

The first estimate is marked "rough". After one run, the app has measured your computer's real speed and the estimates become accurate.

## 5. Everyday use (faster and lighter)

`npm run dev` is meant for development. For daily use, build the app once:

```bash
npm run build
```

Then start it like this whenever you want to use it:

```bash
npm run preview
```

Open **http://localhost:4173**.

Re-run `npm run build` after you install or remove the Rephrase model.

## 6. Host it for others

`npm run build` creates a `dist/` folder of static files. You can host it in any of these ways:

- **Any web server or static host:** upload the contents of `dist/`. For the fastest rephrasing, the server should send these headers (they turn on multi-threading):
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```
- **nginx:** use [deploy/nginx.conf](deploy/nginx.conf). It already sets those headers, compression and a strict security policy.
- **Docker:**
  ```bash
  docker build -f deploy/Dockerfile -t rephraser .
  ```
  ```bash
  docker run -p 8080:80 rephraser
  ```
  Then open http://localhost:8080. If the model is installed when you build, it is included in the image.
- **Your local network:** run `npm run preview -- --host` and open the address it prints from another device.

Notes:

- The model's largest file is 133 MB. That is too large for GitHub Pages and some free hosts (100 MB per-file limit), so host Rephrase on your own server or with Docker. Spelling & Grammar works on any host.
- All processing still happens in each visitor's own browser. Your server only serves files and never sees anyone's text.

## 7. Remove the Rephrase model

```bash
npm run remove:rephrase
```

This frees about 250 MB. Spelling & Grammar keeps working.

## 8. Troubleshooting

**The Rephrase button is greyed out.**
Read the device check card at the top of the Rephrase tab. Usually the model isn't installed: do step 4. If you just installed it, refresh the page. If you use `npm run preview`, run `npm run build` again first.

**The download failed or stopped.**
Run `npm run setup:rephrase` again. It resumes and re-checks the files.

**Rephrasing is slow.**
- Close other browser tabs and apps.
- Use `npm run preview` instead of `npm run dev`.
- Make sure the device card says "Multi-threading on". If it says single-threaded, your server isn't sending the two headers from step 6.

**"Port 5173 is already in use".**
Another copy of the app is running. Close it, or start on a different port:

```bash
npm run dev -- --port 5174
```

**The browser shows "out of memory" or the tab crashes while rephrasing.**
Click **Unload model** when you're done rephrasing, close other tabs, or rephrase shorter pieces of text.

**Some mistakes aren't caught.**
Spelling & Grammar uses fast built-in rules ([Harper](https://writewithharper.com) plus Rephraser's own rules) instead of AI, so it stays light and offline. It fixes spelling, capitals, punctuation, greetings and the most common grammar slips, but it doesn't rewrite sentences the way an AI assistant does. Some fixes are shown as suggestions only (for example unknown names): pick one in the list below the text if it's right.

**It "corrects" my English spelling (colour → color, cancelled → canceled).**
Choose your English at the top right (Indian, British, …). The first time, the app picks it from your browser's language.

**How good is it on my own messages?**
Put your own examples in `test-data/` (see `eval/parse.ts` for the format), then run `npm run eval`. It writes a report to `test-data/eval-report.md`. The `test-data/` folder is git-ignored so private messages are never committed.
