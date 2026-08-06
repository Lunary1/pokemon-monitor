import got from 'got';
import { logger } from './logger';

/** How long a successfully fetched robots.txt stays cached. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a *failed* fetch stays cached. Much shorter than a success: a
 * failure grants blanket access under our fail-open policy, so we want to
 * retry soon rather than let one bad response hand out a day-long pass.
 */
const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;

const FETCH_TIMEOUT_MS = 8_000;

export const DEFAULT_USER_AGENT = 'pokemon-monitor';

interface Rule {
  /** Path pattern as written, may contain `*` and a trailing `$`. */
  pattern: string;
  allow: boolean;
}

interface RobotsRules {
  /** Rules keyed by lowercased user-agent token. */
  groups: Map<string, Rule[]>;
}

interface CacheEntry {
  rules: RobotsRules | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Test-only: clears cached robots.txt between test cases. */
export function resetRobotsCache(): void {
  cache.clear();
}

/**
 * Parse robots.txt into per-user-agent rule groups.
 *
 * Implements the subset of RFC 9309 that affects us: grouped User-agent
 * lines, Allow/Disallow with `*` wildcards and `$` anchors, and comments.
 * Crawl-delay and Sitemap are intentionally ignored — per-domain pacing is
 * handled by throttleDomain(), and sitemaps are irrelevant here.
 */
export function parseRobotsTxt(body: string): RobotsRules {
  const groups = new Map<string, Rule[]>();

  // Consecutive User-agent lines share one rule block, so agents accumulate
  // until the first directive line closes the header.
  let currentAgents: string[] = [];
  let headerOpen = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!headerOpen) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      headerOpen = true;
      continue;
    }

    if (field !== 'allow' && field !== 'disallow') continue;
    headerOpen = false;
    if (currentAgents.length === 0) continue;

    for (const agent of currentAgents) {
      const rules = groups.get(agent) ?? [];
      // `Disallow:` with an empty value means "nothing is disallowed" — it is
      // not a rule, and treating it as one would block the whole site.
      if (field === 'disallow' && value === '') {
        groups.set(agent, rules);
        continue;
      }
      if (value === '') continue;
      rules.push({ pattern: value, allow: field === 'allow' });
      groups.set(agent, rules);
    }
  }

  return { groups };
}

/** Translate a robots.txt path pattern into an anchored RegExp. */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const escaped = body
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

/** Pick the rule group for this agent, falling back to the `*` group. */
function rulesForAgent(rules: RobotsRules, userAgent: string): Rule[] {
  const agent = userAgent.toLowerCase();

  for (const [key, group] of rules.groups) {
    if (key !== '*' && agent.includes(key)) return group;
  }

  return rules.groups.get('*') ?? [];
}

/**
 * Evaluate a path against parsed rules.
 *
 * Longest matching pattern wins; Allow wins ties. That precedence is not
 * cosmetic — a broad `Disallow: /` paired with a narrow `Allow: /products/`
 * is a common shape, and getting it backwards blocks everything.
 */
export function isPathAllowed(
  rules: RobotsRules,
  path: string,
  userAgent: string = DEFAULT_USER_AGENT,
): boolean {
  const applicable = rulesForAgent(rules, userAgent);

  let bestLength = -1;
  let bestAllow = true;

  for (const rule of applicable) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;

    const length = rule.pattern.length;
    if (length > bestLength || (length === bestLength && rule.allow)) {
      bestLength = length;
      bestAllow = rule.allow;
    }
  }

  return bestAllow;
}

async function loadRules(origin: string): Promise<RobotsRules | null> {
  const cached = cache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.rules;

  try {
    const response = await got(`${origin}/robots.txt`, {
      timeout: { request: FETCH_TIMEOUT_MS },
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      throwHttpErrors: false,
      retry: { limit: 0 },
    });

    if (response.statusCode !== 200) {
      // A 404 genuinely means "no rules published". Other non-200s (403, 5xx)
      // mean "unknown" — both fail open, but both are logged and cached only
      // briefly so access is not granted for a full day on a bad response.
      logger.warn(
        { origin, statusCode: response.statusCode },
        'robots.txt not readable, allowing by default',
      );
      cache.set(origin, { rules: null, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
      return null;
    }

    const rules = parseRobotsTxt(response.body);
    cache.set(origin, { rules, expiresAt: Date.now() + CACHE_TTL_MS });
    return rules;
  } catch (err) {
    logger.warn(
      { origin, err: err instanceof Error ? err.message : String(err) },
      'robots.txt fetch failed, allowing by default',
    );
    cache.set(origin, { rules: null, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
    return null;
  }
}

/**
 * Is this URL fetchable under the origin's robots.txt?
 *
 * Fails open: an unreachable or unparseable robots.txt returns true with a
 * warning logged. A store having a bad afternoon should not silently stop
 * monitoring — silent non-monitoring is the failure mode #86 and #88 were
 * both about. The tradeoff is that a site persistently 403ing its own
 * robots.txt is never gated here; that is accepted, not overlooked.
 */
export async function isUrlAllowed(
  url: string,
  options: { userAgent?: string } = {},
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logger.warn({ url }, 'invalid URL passed to robots check, disallowing');
    return false;
  }

  const rules = await loadRules(parsed.origin);
  if (!rules) return true;

  return isPathAllowed(
    rules,
    `${parsed.pathname}${parsed.search}`,
    options.userAgent ?? DEFAULT_USER_AGENT,
  );
}
