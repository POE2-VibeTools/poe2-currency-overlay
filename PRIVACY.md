# Privacy & data

_Last updated: 2026-08-10_

The POE2 Currency Overlay runs on your PC. It has **no analytics, no telemetry, no usage tracking, no background phone-home, and no machine or device IDs**. It reaches the internet only for the things below.

## Where the app connects

- **poe2scout.com** - live currency rates and item icons and price history. Ordinary web requests (poe2scout sees your IP, as any website does).
- **Path of Exile official trade site (pathofexile.com)** - price checks and the currency exchange. These use your own pathofexile.com login, which is stored on your PC and used to talk to GGG directly. We never see your login, your searches, or your items.
- **GitHub** - checking for app updates and fetching the currency feed file.
- **Google (script.google.com)** - only when you submit the in-app Bug or Feedback form.
- **poe2-overlay-api.dbatchell.workers.dev** - only when you use the "Send my stash tabs" button in the Net Worth tab (see below). The app does not contact it otherwise.

## Reading your stash tabs (Net Worth)

The **Net Worth** tab reads a stash tab by taking a screenshot when you trigger a capture (its hotkey or the Capture button) and reading the item counts from it **on your PC**. That screenshot is processed locally and is not saved, uploaded, or sent anywhere. To value what it read, it looks up prices from poe2scout and the public currency-exchange data the same way the rest of the app does: it sends item names and counts, never the screenshot, your account, or your session.

**The one exception is if you choose to send one.** Net Worth is experimental and misreads some setups. The tab has a "Send my stash tabs" button so people it does not work for can help fix it. That button, and only that button, uploads an image. It is entirely optional - if your counts read correctly you never need to touch it, and nothing is captured or sent unless you press it.

When you use it, you pick each tab, **see a preview of exactly what will be sent**, and press Send. Each submission contains:

- an **image of the Path of Exile 2 window** - never your desktop, and never another application. It is cropped to the stash panel when the app finds the panel. When it cannot find it, the whole game window is sent instead, because that framing is the only thing that explains why it failed. The app tells you which one you are about to send, and asks you to confirm each screenshot before Send will work,
- your screen resolution, display scale, the size of the game window, and the calibration box if you set one,
- what the reader made of that image: which tab it thinks it is, the count it read for each slot, and how confident it was,
- the app version and your operating system.

It does not include your login or session, your other stash tabs, anything outside the game window, or any way to identify you. Bear in mind the panel image shows the contents of that stash tab, because that is the thing being diagnosed - and a whole-window image shows whatever else was on screen in game at that moment, which can include your character name and your chat. That is why you are shown every screenshot, can open any of them full size, and cannot send until you have confirmed each one.

Submissions are stored in a private Cloudflare R2 bucket that only the author can read. They are used solely to test and fix the stash reader, and are deleted once that work is done. There is a per-submitter limit; it is enforced using a **salted hash** of your IP address, not the address itself, so no visitor IP list is kept.

## What we actually receive

Two things, both of which you choose to send:

1. **Bug and feedback reports** submitted from the in-app form. A report contains what you type (your description, and an optional contact only if you add one), the app version and a timestamp, and - for bug reports only - a short **activity log**: the last 60 or so in-app actions (buttons clicked, settings toggled, currency and item type names, and any error messages), and the **last item you pasted into the app**, so the problem can be reproduced. Only text the app already recognised as an item is kept, so nothing else you copy can end up in a report. Reports are stored in a private Google Sheet.

   A bug report also has an **"Include system information"** tick box, which describes your machine rather than the app: your screen resolution and scale, the overlay window's size, your operating system, the language the app is set to, and which tab you were on. The form has a link that shows you the exact text before you send, and unticking the box sends none of it.
2. **Stash panel captures**, only if you use "Send my stash tabs", exactly as described above.

That is all. Neither includes your account, your session, or anything personal beyond what you type.

## About the Cloudflare Worker in the repo

The repository includes a Cloudflare Worker (`backend/`) that acts as a currency-price edge cache and receives the optional stash captures described above, with Cloudflare's standard request logging enabled. For currency prices the current app **does not route through it** - it fetches poe2scout directly. If a future build does, it would only ever see currency-price requests (your IP and which league you are viewing), never item, account, or stash data.

## In short

We do not run analytics or telemetry, track usage, phone home in the background, use machine or device IDs, or read your account or session. The Net Worth tab reads your open stash tab from an on-screen screenshot processed on your PC only - that image is never sent anywhere unless you deliberately choose to submit it with the "Send my stash tabs" button, having first seen a preview of it. The only data we receive is what you choose to send us.
