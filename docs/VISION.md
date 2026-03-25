# Product Vision — CTS Anti-Fraud Analytics

> This document is the product vision and roadmap. Reference it for understanding
> WHY decisions were made and WHAT comes next. Last updated: February 2026.

## Problem

Media buyers run Google Ads campaigns through anti-detect browsers. Accounts get banned.
There's no systematic way to:
- Track which combinations of consumables (proxy, payment, account type) lead to bans
- Predict when a ban will happen
- Learn from past bans to improve future campaigns
- Detect ban chains (when shared consumables link accounts)

## Solution

A Chrome Extension that silently collects data from Google Ads dashboard + a backend
that stores, analyzes, and predicts ban outcomes.

## Why NOT Google Ads API

Google Ads API requires a Developer Token + MCC + OAuth client. Using it links all
accounts through shared credentials. One ban → chain reaction.

Our approach: each account is isolated in its own anti-detect browser profile.
The extension works from that profile's context (IP, cookies, fingerprint).
For Google, it's indistinguishable from a normal user.

## 5 Levels of Data Collection

| Level | What | Source |
|-------|------|--------|
| 1 | Domain/Site | Extension + WHOIS + external checks |
| 2 | Account | Extension (Google Ads dashboard) |
| 3 | Campaign/Ad | Extension (Google Ads dashboard) |
| 4 | Traffic/Visits | CTS integration (existing system) |
| 5 | Result (Ban) | Extension + manual input |

## Roadmap

| Step | Phase | Description | Data Requirement |
|------|-------|-------------|-----------------|
| 1 | Foundation | DB schema, types, migrations | — |
| 2 | Collection | Ban log (manual + auto snapshot) | — |
| 3 | Collection | Chrome Extension MVP (XHR intercept) | — |
| 4 | Analysis | Stats dashboard | 50+ cases |
| 5 | Prediction | ML model (XGBoost) | 500+ cases |
| 6 | Automation | Auto-rotation of domains | Mature model |

## Killer Features (all zero-footprint for Google)

1. **Competitive Intelligence** — Auction Insights data accumulation
2. **Creative Decay Detection** — CTR/CPC decline monitoring
3. **Spend Velocity Anomaly** — Safe spend growth rate alerts
4. **Ban Chain Prediction** — Graph of shared consumables
5. **Safe Page Quality Score** — Correlation with lifetime
6. **Timing Intelligence** — Ban frequency heatmaps
7. **Consumable Scoring** — BIN/proxy effectiveness ratings
8. **Auto Post-Mortem** — Instant analysis on ban event

## Multi-AI Architecture (Future — Step 5+)

Three AI models (Claude, Gemini, OpenAI) make independent predictions on the same data.
System tracks accuracy per model per task type. Strategies: Best Model, Majority Vote,
Weighted Ensemble. AI Leaderboard auto-updates weekly.

## ML Learning Phases (Future — Step 5+)

| Cases | Phase | Method |
|-------|-------|--------|
| 0-10 | Expert Rules | Hardcoded rules from team experience |
| 10-50 | Simple Stats | Averages, correlations, basic logistic regression |
| 50-200 | Early ML | Decision Tree / Random Forest |
| 200-500 | Mature ML | XGBoost with full feature set |
| 500+ | Advanced ML | XGBoost + time validation + drift detection |
