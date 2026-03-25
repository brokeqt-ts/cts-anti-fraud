# Architecture Decision Records

## ADR-001: No Google Ads API

**Status:** Accepted  
**Date:** 2026-02-06

**Context:** We need to collect data from Google Ads accounts. The official API exists but requires Developer Token, MCC linkage, and OAuth credentials that connect all accounts.

**Decision:** Use Chrome Extension to intercept browser-level API responses instead of Google Ads API.

**Consequences:**
- ✅ No account linking — each profile is isolated
- ✅ No API quotas or rate limits
- ✅ No approval process from Google
- ❌ Undocumented JSON structures — need reverse engineering
- ❌ Google can change internal API formats (rare, but possible)
- ❌ Data only available when user has Google Ads tab open

---

## ADR-002: XHR/Fetch Interception over DOM Parsing

**Status:** Accepted  
**Date:** 2026-02-06

**Context:** Need to extract data from Google Ads dashboard. Two approaches: parse DOM or intercept API responses.

**Decision:** Intercept `fetch()` and `XMLHttpRequest` responses.

**Consequences:**
- ✅ Immune to UI redesigns (CSS/HTML changes)
- ✅ Structured JSON data (no need to scrape text from elements)
- ✅ Complete data (DOM may not show all fields)
- ❌ Need to reverse-engineer JSON structures
- ❌ Must inject into page context (not content script isolation)

---

## ADR-003: Fastify over Express

**Status:** Accepted  
**Date:** 2026-02-16

**Context:** High-throughput collector endpoint receiving data from 100+ extension instances.

**Decision:** Use Fastify with built-in JSON Schema validation.

**Consequences:**
- ✅ 2-3x faster than Express for JSON-heavy workloads
- ✅ Built-in schema validation (critical for untrusted extension data)
- ✅ Better TypeScript support
- ✅ Plugin system for database, auth, rate limiting
- ❌ Slightly smaller ecosystem than Express (but sufficient)

---

## ADR-004: Raw Payload Preservation

**Status:** Accepted  
**Date:** 2026-02-16

**Context:** Google Ads internal JSON structures are undocumented and may change. We can't predict all useful fields upfront.

**Decision:** Always store the complete raw JSON payload alongside normalized data.

**Consequences:**
- ✅ Can retroactively extract new fields without re-collecting data
- ✅ Debug-friendly — can compare raw vs normalized
- ✅ ML features can be extracted from raw data later
- ❌ Higher storage usage (mitigated by JSONB compression)

---

## ADR-005: npm Workspaces for Monorepo

**Status:** Accepted  
**Date:** 2026-02-16

**Context:** Project has multiple packages (server, web, extension, shared, ml). Need a monorepo manager.

**Decision:** Use npm workspaces (built-in to npm 7+).

**Consequences:**
- ✅ Zero additional tooling — npm handles everything
- ✅ Shared `node_modules` at root level
- ✅ Simple cross-package references
- ❌ No advanced features like turborepo's caching (can add later if needed)
