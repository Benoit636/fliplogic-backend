# FlipLogic — Product Direction

FlipLogic is the acquisition decision layer that sits after a dealership's
existing appraisal tool (vAuto, AutoTrader, Dealertrack, CDK, PBS, Reynolds,
etc.) and before the buy decision is made. It does not try to replace those
tools on valuation — it turns appraisal data into a buying decision.

The question every endpoint ultimately serves is "Should I buy this
vehicle, and what's the max I can pay?" — not "what is this car worth?"

## Before building or approving anything

Ask: **Would this help a dealership buy inventory more profitably, or is it
simply another source of information?**

If a proposed feature is just more information — another data point, field,
report, or integration — without changing the buy/negotiate/walk-away
verdict or the max price a dealer should pay, it doesn't belong here. Push
back or scope it down before building it.

## Also keep in mind

- Don't overbuild. Don't add unnecessary features. Don't turn this back
  into a full appraisal platform.
- Manual entry of appraisal data (`POST /api/appraisals/manual`) is the
  primary intake path (Phase 1). Importing from appraisal tools, CRM
  integration, PDF export, a dealer dashboard, auction batch analysis, and
  other API integrations are explicitly Phase 2 — don't build them unless
  asked. The AutoTrader scraper and old VIN-decode create/analyze flow stay
  in place as dormant groundwork, not the focus.
- `buildBuyDecisionReport()` in `src/services/buyDecisionReport.js` is the
  core calculation engine (max buy price, expected gross, risk, confidence,
  verdict) — reuse and extend it rather than duplicating its logic.
- Postgres NUMERIC columns come back as strings via `pg` — always
  `Number()`-coerce before arithmetic.
