# Term Watch — Privacy Policy

**Effective date: November 18, 2026**

Term Watch is a Reddit Devvit app that subreddit moderators install on their
subreddit. This policy describes exactly what data the app touches.

## What the app processes

When a new post or comment is submitted to a subreddit where the app is
installed, Reddit delivers it to the app. The app checks the post title and
body (or comment body) against a term list fetched from a moderator-supplied
URL. Content that does not match a term is discarded immediately — it is not
stored and not sent anywhere.

## What gets sent to Discord

When a term matches, the app sends one alert to the Discord webhook configured
by that subreddit's moderators. The alert contains:

- the post title (or the title of the post the comment is on),
- a snippet of the post or comment text (up to 600 characters; for link posts
  with no text, the submitted link),
- the matched term(s),
- the author's Reddit username,
- the subreddit name and a permalink to the post or comment,
- a timestamp, plus an optional moderator-configured mention (e.g. a role ping).

All of this is public Reddit content. Once delivered, it lives in the
moderators' Discord channel and is subject to
[Discord's Privacy Policy](https://discord.com/privacy) and the moderators'
own retention practices.

## What the app stores

The app stores only two things, in Devvit's Redis storage scoped to the
installation:

- **Dedupe keys** — one key per already-alerted post or comment ID (no content,
  just the ID), which expires automatically after 2 days. This prevents
  duplicate alerts when Reddit redelivers a trigger.
- **Term list cache** — the term list fetched from the moderator's URL, cached
  and refreshed after 5 minutes. It contains no user data.

Operational logs (e.g. matched content IDs, author username, and matched terms
on a match) go to Devvit's standard app logging, which is retained and
controlled by Reddit's platform.

The app has no database of users, no tracking, no analytics, no cookies, and
it does not sell or share data with anyone other than the Discord webhook
described above.

## Settings

The terms URL, webhook URL, matching options, ignored usernames, and mention
text are provided by subreddit moderators and stored by Reddit's Devvit
settings system. They are visible to that subreddit's moderators on the app's
install settings page.

## Outbound connections

The app makes exactly two kinds of outbound requests: fetching the
moderator-configured term list URL, and posting alerts to the
moderator-configured Discord webhook. Allowed domains are declared in the
app's configuration and enforced by the Devvit platform.

## Your choices

- Moderators can stop all processing by uninstalling the app, or stop alerts
  by clearing the webhook or terms URL settings.
- Reddit users who have questions about an alert that referenced their public
  post or comment can contact the subreddit's moderators (who control the
  Discord channel) or the developer below.

## Changes

Material changes will be reflected in this document with an updated effective
date in the app's public repository.

## Contact

privacy@mediacrew.dev
