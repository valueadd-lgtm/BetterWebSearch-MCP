import { withRetry } from "../utils/retry.js";
import { limiterFor } from "../utils/rateLimit.js";
import type { SearchOptions, SearchProvider, SearchResult } from "./types.js";

const YOUCOM_ENDPOINT = "https://api.you.com/v1/agents/search";
const TIMEOUT_MS = 8_000;

/** User-Agent for You.com API attribution (see integration-tracking skill). */
const YOUCOM_USER_AGENT =
  "youdotcom-integration/phantompixeldev-betterwebsearch-mcp";

/** A single result from either endpoint (fields vary by keyed/keyless path). */
interface YoucomResult {
  title?: string;
  url?: string;
  description?: string;
  /** Singular snippet (keyed POST response). */
  snippet?: string;
  /** Array of snippets (keyless GET response). */
  snippets?: string[];
  page_age?: string;
}

/** Build the snippet text from whichever fields the response includes. */
function buildSnippet(r: YoucomResult): string {
  const parts: string[] = [];
  if (typeof r.snippet === "string" && r.snippet) {
    parts.push(r.snippet);
  }
  if (Array.isArray(r.snippets) && r.snippets.length > 0) {
    parts.push(...r.snippets);
  }
  if (r.description && !parts.includes(r.description)) {
    parts.push(r.description);
  }
  return parts.join(" ") || "";
}

/**
 * You.com Search provider (keyless-first, optional keyed).
 *
 * Uses the keyless free-tier endpoint (`GET` with no auth, 100 searches/day
 * per IP) by default. When `YDC_API_KEY` is set, switches to the keyed
 * endpoint (`POST` with `X-API-Key`) for higher limits.
 *
 * On any failure (missing key on the keyed path, HTTP error, timeout, network
 * error) it returns an empty array and logs a warning rather than throwing, so
 * one failing provider never breaks the aggregate search.
 */
export class YouComProvider implements SearchProvider {
  readonly name = "youcom";

  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    const { loadConfig } = await import("../utils/config.js");
    const cfg = loadConfig();
    const apiKey = cfg.youcomApiKey;
    const maxResults = opts.count ?? 10;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const limiter = limiterFor("youcom");

    try {
      let response: Response;

      if (apiKey) {
        // Keyed path: POST with X-API-Key, flat results[] response
        response = await limiter.schedule(() =>
          withRetry(
            () =>
              fetch(YOUCOM_ENDPOINT, {
                method: "POST",
                headers: {
                  "X-API-Key": apiKey,
                  "Content-Type": "application/json",
                  "User-Agent": YOUCOM_USER_AGENT,
                },
                body: JSON.stringify({ query, max_results: maxResults }),
                signal: controller.signal,
              }),
            { retryOn: [429, 503], retryNetworkErrors: true },
          ),
        );
      } else {
        // Keyless path: GET with query params, results.web[] response
        const params = new URLSearchParams({
          query,
          max_results: String(maxResults),
        });
        response = await limiter.schedule(() =>
          withRetry(
            () =>
              fetch(`${YOUCOM_ENDPOINT}?${params.toString()}`, {
                headers: {
                  "User-Agent": YOUCOM_USER_AGENT,
                },
                signal: controller.signal,
              }),
            { retryOn: [429, 503], retryNetworkErrors: true },
          ),
        );
      }

      if (!response.ok) {
        console.warn(
          `[youcom] API returned ${response.status}; returning no results.`,
        );
        return [];
      }

      const data = (await response.json()) as {
        results?: YoucomResult[] | { web?: YoucomResult[] };
      };
      const raw = data.results;

      // Handle both response shapes: flat array (keyed) or nested {web:[]} (keyless)
      let items: YoucomResult[];
      if (Array.isArray(raw)) {
        items = raw as YoucomResult[];
      } else if (raw && typeof raw === "object" && "web" in raw) {
        items = (raw as { web?: YoucomResult[] }).web ?? [];
      } else {
        items = [];
      }

      return items
        .slice(0, maxResults)
        .filter((r) => r.url && r.title)
        .map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: buildSnippet(r),
          published: r.page_age,
          source: this.name,
        }));
    } catch (error) {
      console.warn(
        `[youcom] search failed (${error instanceof Error ? error.message : String(error)}); returning no results.`,
      );
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}