# Term Watch

A Devvit app that watches new posts and comments in the subreddit it's installed on.
When one contains a configured term, it posts an alert embed to a Discord webhook.

## How it works

- The watch terms are fetched from a moderator-configured URL and cached in Redis for 5 minutes. If a fetch fails, the last successfully fetched list is used.
- `onPostSubmit` and `onCommentSubmit` triggers fire for each new post and comment.
- The post title and body, or the comment body, are checked against the fetched term list.
- On a match, the app POSTs an embed to the Discord webhook. Redis dedupes repeat trigger deliveries.

## Settings

**Subreddit settings** (moderators edit these on the app's install settings page):

| Setting | Default | Notes |
|---|---|---|
| Discord webhook URL | — | `https://discord.com/api/webhooks/…` (or `discordapp.com`); alerts for this subreddit go here |
| Terms list URL | — | HTTPS URL whose response body is the term list: a JSON array or one-per-line / comma-separated |
| Whole-word matching | on | `sublink` won't match `sublinked` |
| Case sensitive | off | |
| Ignore these usernames | `AutoModerator` | comma-separated |
| Discord mention | blank | e.g. `<@&ROLE_ID>` to ping a role |

Each subreddit's moderators configure their own webhook. If no webhook is configured yet,
matches are logged and the Discord ping is skipped.

## Fetch Domains

The following domains are requested for this app:

- `discord.com`, `discordapp.com` - Used to send term-match alerts to the Discord webhook configured by each subreddit's moderators. No Reddit user data is sent beyond the matched post or comment's title, a text snippet, the author's username, and the permalink.
- `raw.githubusercontent.com` - Example host for the terms list URL. **Replace or extend this** in `devvit.json` (`permissions.http.domains`) with whichever domain actually serves your terms list — Devvit only allows `fetch()` to domains declared there.

## Terms & Privacy

- [Terms of Service](TERMS.md)
- [Privacy Policy](PRIVACY.md)

Point the Devvit publish form at the hosted URLs of these files once the repo is public.

## Development

```bash
npm install
npm test          # matching unit tests
npm run build     # bundles to dist/server/index.js
npx devvit login
npm run dev       # devvit playtest on your test subreddit
npm run launch    # devvit publish (unlisted review)
```
