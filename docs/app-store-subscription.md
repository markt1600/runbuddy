# Tekan Buddy on the App Store: the subscription

The app has two plans (`lib/plan.ts`): **free** plays every rendered line,
**full** adds everything that goes through the model. The plan is decided on
the server per request; the iOS shell buys the subscription through
RevenueCat, and the server reads RevenueCat's API to pin the plan on the
profile. The web app sells nothing — it runs whatever plan the account has.

Until launch, `DEFAULT_PLAN` is unset, so every account (and every guest) is
on **full**. Flip it to `free` on Vercel when the subscription goes on sale.

## What is already built

- `lib/plan.ts`, `lib/server/plan.ts` — the plans and the server-side gate.
  `/api/phrase` and `/api/cameo` answer 402 on free; cheers are
  read word for word on free; the coach mirrors the plan and never asks.
- `lib/purchases.ts` — the RevenueCat Capacitor plugin, loaded only in the
  shell, configured with the account's uid hash as the app user id.
- `components/SubscribeScreen.tsx` — prices from the store, buy, restore,
  the Apple-required wording, links to the Terms of Use (Apple's standard
  EULA) and `/privacy`. Reached from Account → "Get Full" / "Manage plan".
- `/api/plan/sync` — the app calls it after a purchase or restore; the
  server re-reads RevenueCat and pins the plan.
- `/api/plan/webhook` — RevenueCat's events (renewal, lapse, refund, billing
  issue); same re-read, so the plan follows the store while the app is shut.
- Admin → user → Plan pin (default / free / full), for trying a free run
  before anything is sold.
- `app/privacy/page.tsx` — the privacy policy, written from what the app
  stores; its contact comes from `NEXT_PUBLIC_SUPPORT_EMAIL`.
- `/api/account` (DELETE) and `lib/server/deleteAccount.ts` — account
  deletion, reached from the foot of the Account screen.

## What to set up

### 1. App Store Connect

1. **Agreements, Tax and Banking** → accept the Paid Apps agreement and fill
   in banking and tax. Subscriptions cannot be created or tested until this
   is active.
2. **Your app → Subscriptions** → create a Subscription Group (for example
   "Tekan Buddy Full"), then the products inside it. Suggested product ids,
   matching the bundle id:
   - `ai.marktan.runbuddy.full.monthly`
   - `ai.marktan.runbuddy.full.yearly`
   Set price, duration and localisation (display name and description) for
   each. An optional introductory offer (free week) is set here too.
3. **App Information** → set the Privacy Policy URL to
   `https://run.marktan.ai/privacy` and, under Age Rating, answer for
   frequent profanity (the Bengs earn 17+).
4. **App Privacy** → declare what the privacy policy says: name, email,
   location (precise, run tracking), health and fitness, purchases, user
   content (comments, cheers), identifiers.
5. **Users and Access → Sandbox** → add a Sandbox tester Apple ID for
   testing purchases on a device.
6. **Users and Access → Integrations → In-App Purchase** → generate an
   In-App Purchase key (RevenueCat needs it), and note the Issuer ID and
   Key ID.
7. Rename the app to Tekan Buddy here if not done already.

### 2. RevenueCat (free up to the first real revenue)

1. Create a project and an **iOS app** in it with bundle id
   `ai.marktan.runbuddy`. Upload the In-App Purchase key from step 1.6 and
   the App-Specific Shared Secret (App Store Connect → your app → App
   Information → App-Specific Shared Secret).
2. **Products** → import the two products from App Store Connect.
3. **Entitlements** → create one with identifier **`full`** and attach both
   products. The identifier must be exactly `full` (`lib/subscription.ts`).
4. **Offerings** → the `default` offering with a monthly and an annual
   package pointing at the two products. The Subscribe screen lists whatever
   packages the offering has.
5. **API keys** → copy the public iOS SDK key (`appl_…`) and a secret key.
6. **Integrations → Webhooks** → URL `https://run.marktan.ai/api/plan/webhook`,
   Authorization header value: a long random string you make up.

### 3. Vercel environment variables

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_REVENUECAT_IOS_KEY` | the public iOS SDK key |
| `REVENUECAT_SECRET_KEY` | the secret API key |
| `REVENUECAT_WEBHOOK_SECRET` | the Authorization string from the webhook |
| `DEFAULT_PLAN` | leave unset until launch, then `free` |

### 4. Xcode, on the Mac

```
npm install
npx cap sync ios
```

Then in Xcode: **Signing & Capabilities → + Capability → In-App Purchase**
(also enable it on the App ID in the developer portal if it isn't already).
Build to TestFlight. Sandbox purchases work on a device signed into the
Sandbox tester (Settings → App Store → Sandbox Account).

### 5. Before submitting

- Set `NEXT_PUBLIC_SUPPORT_EMAIL` on Vercel so `/privacy` shows a contact
  (without it the page points at the listing's support link), and put the
  same address as the Support URL / contact in App Store Connect.
- Account deletion is built: Account → Delete my account → Delete
  everything wipes the profile, runs, stats, friends, comments on their
  runs, cheers, receipts, presence, link records and the RevenueCat
  customer, then drops the session (`lib/server/deleteAccount.ts`).
- Reviewers buy with a sandbox account: make sure a fresh sandbox account
  can go Account → Get Full → buy → see "Full" on Account, and Restore
  purchases on a second device.
- Once live: set `DEFAULT_PLAN=free`. Existing accounts keep full only if
  they subscribe (or you pin them in Admin).
