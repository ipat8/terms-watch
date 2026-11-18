// Pure matching helpers — no Devvit imports, so they can be unit-tested with plain Node.

export type MatchOptions = { wholeWord: boolean; caseSensitive: boolean };

/** Accepts a JSON array (["a","b"]) or a newline / comma separated list. */
export function parseTerms(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const text = raw.trim();
  if (!text) return [];

  let list: unknown[] | undefined;
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      /* fall through to delimited parsing */
    }
  }
  list ??= text.split(/[\n,]/);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const term = String(item ?? '').trim();
    const key = term.toLowerCase();
    if (term && !seen.has(key)) {
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatchers(terms: string[], opts: MatchOptions): Array<[string, RegExp]> {
  const flags = opts.caseSensitive ? 'u' : 'iu';
  return terms.map((term) => {
    let body = escapeRegex(term);
    // Lookarounds instead of \b so terms with punctuation (e.g. "c++") still work
    if (opts.wholeWord) body = `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`;
    return [term, new RegExp(body, flags)];
  });
}

export function findMatches(text: string, matchers: Array<[string, RegExp]>): string[] {
  return matchers.filter(([, rx]) => rx.test(text)).map(([term]) => term);
}

export function parseNameList(raw: unknown): Set<string> {
  if (typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(/[\n,]/)
      .map((s) => s.trim().replace(/^\/?u\//i, '').toLowerCase())
      .filter(Boolean),
  );
}

export function truncate(text: string | undefined, n: number): string {
  const t = (text ?? '').trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
}

export function absoluteUrl(permalink: string | undefined): string | undefined {
  if (!permalink) return undefined;
  return permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
}
