import type { IncomingMessage, ServerResponse } from 'node:http';
import { context, createServer, getServerPort, redis, settings } from '@devvit/web/server';
import type {
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  SettingsValidationRequest,
  SettingsValidationResponse,
  TriggerResponse,
} from '@devvit/web/shared';
import {
  absoluteUrl,
  buildMatchers,
  findMatches,
  parseNameList,
  parseTerms,
  truncate,
} from './match.ts';

const SNIPPET_LEN = 600;
const DEDUPE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const TERMS_CACHE_KEY = 'termsCache';
const TERMS_CACHE_TTL_MS = 5 * 60 * 1000;

// --------------------------------------------------------------------------- //
// Terms list (fetched from a moderator-configured URL, cached in redis)
// --------------------------------------------------------------------------- //
type TermsCache = { url: string; terms: string[]; fetchedAt: number };

async function readTermsCache(): Promise<TermsCache | undefined> {
  const raw = await redis.get(TERMS_CACHE_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as TermsCache;
  } catch {
    return undefined;
  }
}

async function getTerms(url: string): Promise<string[]> {
  if (!url) return [];
  const cached = await readTermsCache();
  if (cached && cached.url === url && Date.now() - cached.fetchedAt < TERMS_CACHE_TTL_MS) {
    return cached.terms;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const terms = parseTerms(await res.text());
    const entry: TermsCache = { url, terms, fetchedAt: Date.now() };
    await redis.set(TERMS_CACHE_KEY, JSON.stringify(entry));
    return terms;
  } catch (err) {
    console.error(`Failed to fetch terms from ${url}:`, err);
    // Fall back to the last successfully fetched list rather than going blind.
    return cached && cached.url === url ? cached.terms : [];
  }
}

// --------------------------------------------------------------------------- //
// Config
// --------------------------------------------------------------------------- //
async function loadConfig() {
  const [termsUrl, wholeWord, caseSensitive, ignoreAuthors, mention, webhook] = await Promise.all([
    settings.get<string>('termsUrl'),
    settings.get<boolean>('wholeWord'),
    settings.get<boolean>('caseSensitive'),
    settings.get<string>('ignoreAuthors'),
    settings.get<string>('mention'),
    settings.get<string>('discordWebhookUrl'),
  ]);
  return {
    matchers: buildMatchers(await getTerms((termsUrl ?? '').trim()), {
      wholeWord: wholeWord ?? true,
      caseSensitive: caseSensitive ?? false,
    }),
    ignoreAuthors: parseNameList(ignoreAuthors ?? 'AutoModerator'),
    mention: (mention ?? '').trim(),
    webhook: (webhook ?? '').trim(),
  };
}

// Triggers can be delivered more than once — remember what we've alerted on.
async function firstTimeSeen(id: string): Promise<boolean> {
  const key = `alerted:${id}`;
  if (await redis.exists(key)) return false;
  await redis.set(key, '1', { expiration: new Date(Date.now() + DEDUPE_TTL_MS) });
  return true;
}

// --------------------------------------------------------------------------- //
// Discord
// --------------------------------------------------------------------------- //
type Embed = Record<string, unknown>;

async function sendToDiscord(webhook: string, mention: string, embed: Embed): Promise<void> {
  const payload: Record<string, unknown> = {
    embeds: [embed],
    username: 'Term Watch',
    allowed_mentions: mention ? { parse: ['roles', 'users', 'everyone'] } : { parse: [] },
  };
  if (mention) payload.content = mention;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min((body.retry_after ?? 1) * 1000 + 250, 10_000);
      console.warn(`Discord rate limited, waiting ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      console.error(`Discord error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return;
  }
  console.error('Gave up sending to Discord after retries');
}

function buildEmbed(opts: {
  kind: 'post' | 'comment';
  title: string;
  body: string;
  url: string | undefined;
  author: string;
  terms: string[];
}): Embed {
  const isPost = opts.kind === 'post';
  return {
    title: truncate(isPost ? `New post: ${opts.title}` : `New comment on: ${opts.title}`, 256),
    url: opts.url,
    description: truncate(opts.body, SNIPPET_LEN) || '*(no text)*',
    color: isPost ? 0xff4500 : 0x5865f2,
    fields: [
      { name: 'Matched', value: truncate(opts.terms.join(', '), 1024), inline: true },
      { name: 'Author', value: `u/${opts.author}`, inline: true },
      { name: 'Subreddit', value: `r/${context.subredditName ?? 'unknown'}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
}

// --------------------------------------------------------------------------- //
// Handlers
// --------------------------------------------------------------------------- //
async function onPostSubmit(input: OnPostSubmitRequest): Promise<void> {
  const post = input.post;
  if (!post) return;
  const author = input.author?.name ?? '[unknown]';
  const cfg = await loadConfig();
  if (cfg.matchers.length === 0) return;
  if (cfg.ignoreAuthors.has(author.toLowerCase())) return;

  const terms = findMatches(`${post.title}\n${post.selftext}`, cfg.matchers);
  if (terms.length === 0) return;
  if (!cfg.webhook) {
    console.warn(`Match in post ${post.id} but discordWebhookUrl is not configured; skipping ping`);
    return;
  }
  if (!(await firstTimeSeen(post.id))) return;

  console.log(`Match in post ${post.id} by u/${author}: ${terms.join(', ')}`);
  await sendToDiscord(
    cfg.webhook,
    cfg.mention,
    buildEmbed({
      kind: 'post',
      title: post.title,
      body: post.selftext || (post.isSelf ? '' : post.url),
      url: absoluteUrl(post.permalink),
      author,
      terms,
    }),
  );
}

async function onCommentSubmit(input: OnCommentSubmitRequest): Promise<void> {
  const comment = input.comment;
  if (!comment) return;
  const author = input.author?.name ?? '[unknown]';
  const cfg = await loadConfig();
  if (cfg.matchers.length === 0) return;
  if (cfg.ignoreAuthors.has(author.toLowerCase())) return;

  const terms = findMatches(comment.body, cfg.matchers);
  if (terms.length === 0) return;
  if (!cfg.webhook) {
    console.warn(
      `Match in comment ${comment.id} but discordWebhookUrl is not configured; skipping ping`,
    );
    return;
  }
  if (!(await firstTimeSeen(comment.id))) return;

  console.log(`Match in comment ${comment.id} by u/${author}: ${terms.join(', ')}`);
  await sendToDiscord(
    cfg.webhook,
    cfg.mention,
    buildEmbed({
      kind: 'comment',
      title: input.post?.title ?? 'a post',
      body: comment.body,
      url: absoluteUrl(comment.permalink),
      author,
      terms,
    }),
  );
}

function validateTermsUrl(req: SettingsValidationRequest<string>): SettingsValidationResponse {
  const value = (req.value ?? '').trim();
  if (!value) return { success: false, error: 'Enter the URL of your terms list.' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { success: false, error: 'Not a valid URL.' };
  }
  if (url.protocol !== 'https:') return { success: false, error: 'URL must use https.' };
  return { success: true };
}

// Must stay in sync with permissions.http.domains in devvit.json.
const WEBHOOK_HOSTS = new Set(['discord.com', 'discordapp.com']);

function validateWebhookUrl(req: SettingsValidationRequest<string>): SettingsValidationResponse {
  const value = (req.value ?? '').trim();
  if (!value) return { success: false, error: 'Enter your Discord webhook URL.' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { success: false, error: 'Not a valid URL.' };
  }
  if (
    url.protocol !== 'https:' ||
    !WEBHOOK_HOSTS.has(url.hostname) ||
    !url.pathname.startsWith('/api/webhooks/')
  ) {
    return {
      success: false,
      error: 'Must be a Discord webhook URL like https://discord.com/api/webhooks/…',
    };
  }
  return { success: true };
}

// --------------------------------------------------------------------------- //
// HTTP plumbing (plain Node handler — no framework needed for three routes)
// --------------------------------------------------------------------------- //
const routes: Record<string, (body: any) => Promise<unknown> | unknown> = {
  '/internal/on-post-submit': async (b: OnPostSubmitRequest) => {
    await onPostSubmit(b);
    return { status: 'ok' } satisfies TriggerResponse;
  },
  '/internal/on-comment-submit': async (b: OnCommentSubmitRequest) => {
    await onCommentSubmit(b);
    return { status: 'ok' } satisfies TriggerResponse;
  },
  '/internal/settings/validate-terms-url': (b: SettingsValidationRequest<string>) =>
    validateTermsUrl(b),
  '/internal/settings/validate-webhook-url': (b: SettingsValidationRequest<string>) =>
    validateWebhookUrl(b),
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': payload.length, // Devvit runtime rejects responses without it
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0];
  const handler = req.method === 'POST' ? routes[path] : undefined;
  if (!handler) return sendJson(res, 404, { status: 'error', message: 'not found' });

  try {
    sendJson(res, 200, await handler(await readJson(req)));
  } catch (err) {
    // Still ack the trigger so Reddit doesn't hammer retries on a bad message.
    console.error(`Error handling ${path}:`, err instanceof Error ? err.stack : err);
    sendJson(res, 200, { status: 'ok' });
  }
});

server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort());
