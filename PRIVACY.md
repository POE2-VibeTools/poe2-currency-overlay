# Privacy & data

_Last updated: 2026-07-25_

The POE2 Currency Overlay runs on your PC. It has **no analytics, no telemetry, no usage tracking, no background phone-home, and no machine or device IDs**. It reaches the internet only for the things below.

## Where the app connects

- **poe2scout.com** - live currency rates and item icons and price history. Ordinary web requests (poe2scout sees your IP, as any website does).
- **Path of Exile official trade site (pathofexile.com)** - price checks and the currency exchange. These use your own pathofexile.com login, which is stored on your PC and used to talk to GGG directly. We never see your login, your searches, or your items.
- **GitHub** - checking for app updates and fetching the currency feed file.
- **Google (script.google.com)** - only when you submit the in-app Bug or Feedback form.

## What we actually receive

The only data that reaches us is the **bug and feedback reports you choose to send**. A report contains:

- what you type (your description, and an optional contact only if you add one),
- the app version and a timestamp,
- for bug reports only, a short **activity log**: the last 60 or so in-app actions (buttons clicked, settings toggled, currency and item type names, and any error messages), so the problem can be reproduced.

That is all. It does not include your account, your session, your stash, or anything personal beyond what you type. Reports are stored in a private Google Sheet.

## About the Cloudflare Worker in the repo

The repository includes a Cloudflare Worker (`backend/`) that acts as a currency-price edge cache, with Cloudflare's standard request logging enabled. The current app **does not connect to it** - it fetches poe2scout directly - so it is not logging anyone. If a future build routes through it, it would only ever see currency-price requests (your IP and which league you are viewing), never item, account, or stash data.

## In short

We do not run analytics or telemetry, track usage, phone home in the background, use machine or device IDs, or read your account, session, or stash. The only data we receive is the bug and feedback reports you choose to send.
