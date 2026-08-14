# Privacy & data

_Last updated: 2026-08-14_

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

## Reading the price dialog (Reprice)

While **reprice mode** is switched on (its hotkey arms and disarms it), the app watches the screen the game is on so that when you right-click an item to reprice, it can read the number out of the game's own "Set Item Price" dialog. That happens **on your PC**: frames are read, searched for the price field, and discarded. Nothing is saved and nothing is sent. When reprice mode is off, nothing is captured at all.

## What we actually receive

These are the only things we receive, all of which you choose to send:

1. **Bug and feedback reports** submitted from the in-app form. A report contains what you type (your description, and an optional contact only if you add one), the app version and a timestamp, and - for bug reports only - a short **activity log**: the last 60 or so in-app actions (buttons clicked, settings toggled, currency and item type names, and any error messages), and the **last item you pasted into the app**, so the problem can be reproduced. Only text the app already recognised as an item is kept, so nothing else you copy can end up in a report. Reports are stored in a private Google Sheet.

   A bug report also has an **"Include system information"** tick box, which describes your machine rather than the app: your screen resolution and scale, the overlay window's size, your operating system, the language the app is set to, and which tab you were on. The form has a link that shows you the exact text before you send, and unticking the box sends none of it.
2. **Stash panel captures**, only if you use "Send my stash tabs", exactly as described above.
3. **Price field crops**, only if you press Send in Settings > Reprice. If reprice meets a screen size the app has no digit templates for, it keeps the small crop of the price box - the number and the coloured block behind it, a few hundred bytes - and offers to send it so that size can be supported. Sent with it: the number you type in to say what the price really was, what the app read instead, your screen resolution and scale, the app version and your operating system. No item name, no account name, and nothing from anywhere else on your screen. The crops are shown to you before you send, nothing goes without the button press, and Discard throws them away.
4. **Screen-size submissions for Reprice**, only if you use "Submit your screen size" in Settings > Reprice and press Send. You take three screenshots of the game's "Set Item Price" dialog with known numbers typed in, following the example images shown. Each upload is a **centre crop of the game window** around that dialog - which can include the name and icon of the item being priced, whatever scenery sits behind the dialog, and sometimes nearby chat lines; your stash panels lie outside the crop. You see exactly what was captured before anything is sent. Sent with it: your screen resolution and display scale, the game window's size, what the app's reader made of the frame, the app version and your operating system. You see each capture, can open it full size, and must confirm each one against its example before Send unlocks. These go to the same private bucket as the stash captures, under the same rules.

That is all. None of it includes your account, your session, or anything personal beyond what you type.

## About the Cloudflare Worker in the repo

The repository includes a Cloudflare Worker (`backend/`) that acts as a currency-price edge cache and receives the optional stash captures described above, with Cloudflare's standard request logging enabled. For currency prices the current app **does not route through it** - it fetches poe2scout directly. If a future build does, it would only ever see currency-price requests (your IP and which league you are viewing), never item, account, or stash data.

## In short

We do not run analytics or telemetry, track usage, phone home in the background, use machine or device IDs, or read your account or session. The Net Worth tab reads your open stash tab, and reprice mode reads the game's price dialog, from on-screen captures processed on your PC only - those images are never sent anywhere unless you deliberately choose to submit one with the "Send my stash tabs" button or the Reprice submission in Settings, having first seen a preview of it. The only data we receive is what you choose to send us.
