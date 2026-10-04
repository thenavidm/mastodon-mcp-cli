# Mastodon MCP Server & CLI changelog

| Component | Version | Last Updated |
|-----------|---------|--------------|
| mastodon-mcp-cli | 2.0.0 | 2026-10-05 |
| @thenavidm/slipway | 0.1.6 | 2026-10-05 |

---

## 2.0.0, 2026-10-05

Built on [Slipway](https://github.com/thenavidm/slipway) 0.1.6. The 76 tools keep their names and arguments, and every difference below was measured against 1.1.3 before release.

- **A person approves each post, edit, delete, block, report and poll vote over MCP.** Claude Code (2.1.246 and later) shows its own prompt for each one, and a client that can show forms asks with an approval form whose one box starts unticked. Approvals are signed, bound to the exact call and work once. Where a client can do neither, the model's `confirm: true` still counts, and `MASTODON_CONFIRM=model` makes it enough everywhere, for an agent with no person to ask. The audit log records who approved each write.
- **A smaller tool list.** 21,580 tokens in Claude Code with every tool loaded, down from 24,370: the per-tool `$schema` line, an `execution` field and `additionalProperties: false` are gone. The last one advertised strict input while unknown keys were dropped anyway; the schema now says what happens.
- **Exit codes follow the house contract everywhere.** An unknown command, a write in read-only mode, and `login` or `logout` without a name exit 2 instead of 1, and `doctor` with nothing configured exits 10 instead of 1. 1 now means an unexpected error, and an instance that cannot be reached still exits 5.
- **Cheaper through the CLI.** In Codex, finding the command that edits a published status took 84,248 input tokens instead of 108,296 (median of five): `which <words>` finds a command without the full list, and 2.0.0 got there in three commands every time where 1.1.3 needed up to six. Over MCP the same task read about 77,800 on both.
- **`install <client>`** adds the server to Claude Code, Codex, Claude Desktop, Cursor, VS Code or Gemini CLI in each one's own format, naming only the settings that connect an account.
- **Less work to start.** The entry turns on Node's compile cache, and the server spends 211 ms of CPU before its first answer where 1.1.3 spent 247 (median of 21 runs, taking turns on one busy Mac). npx installs 4 dependencies instead of 94.
- **`--help` lists every setting the server reads**, Slipway's own included, `login <instance>` and `logout` show what they take, and restored tests keep the README and `--help` in step with the code.
- **`doctor` asks the instance every time, as before, and says what it found.** An instance that never answered passed as reachable on the fallback limits and was told to sign in again; it now fails as unreachable, and `login` is offered only when the instance refused the token.
- **README fixes.** The exit-code example script no longer reads the status of `!`, the HTTP port is documented as the 8787 the server always used, `/health` is described as it answers, the release workflow attaches the desktop extension the README sends people to, and images load from cdn.navid.me. THIRD_PARTY_NOTICES.md lists the production dependencies' licenses.

### Upgrading

Node 22 or newer. Scripts keep working for success, usage errors and missing setup; a script that treated exit 1 as "unknown command" or "read-only" should read 2. Over MCP, expect an approval prompt or form for each post; a headless agent that should post with `confirm: true` alone needs `MASTODON_CONFIRM=model`. A script that pipes JSON-RPC into the server must keep stdin open until it reads the answer: the server now stops when its input ends, as the MCP stdio binding asks. Over HTTP, `GET /health` returns the name, version and tool count, and no longer tells anyone who can reach it how many accounts are connected. Two terminal screens grew: the general help by 108 tokens, for `which`, `install`, the flags, the exit codes and the safety settings it now lists, and the command list by 24, for the lines that point to `which` and `--help`. `SKILL.md` is 54 tokens longer, for the approval rule, `which` and the full exit codes.

## 1.1.3, 2026-10-04

- **`npx -y @thenavidm/mastodon-mcp-cli` always starts the MCP server.** npx starts whichever binary the npm registry lists first when they share one file, and the registry does not keep the published order, so an MCP client set up with this README's install line could get `mastodon-cli` and its command list instead of a server. A third binary named after the package now always starts the server, and npx picks it by name.

## 1.1.2

Mastodon has quote posts, and this said it did not.

The server instructions, the `boost_status` description, SKILL.md and the README
all stated flatly that Mastodon has no native quote post. It gained them in
4.5.0, `mastodon` API version 7: `quoted_status_id` and `quote_approval_policy`
on `POST /api/v1/statuses`, plus `GET /api/v1/statuses/:id/quotes`.
mastodon.social reports API version 11, so it has had them for a while.

`post_status` still takes no quote parameter, so the advice is unchanged: post a
status containing the URL and boost the original. What changed is that this no
longer blames the platform for a gap that is this server's.

---

## 1.1.1

Docs only. The 1.1.0 tarball went to npm before the README learned that the
desktop extension is attached to the release, and before INSTALL.md covered the
CLI at all. npm serves whatever was in the published tarball, so the package
page needed a release of its own to catch up.

---

## 1.1.0

A second surface, and a new name to match it.

### `mastodon-cli`

Every one of the 76 tools is now a shell command under the same name with
dashes, generated from the same `ALL_TOOLS` array the MCP server registers.
Flags are derived from each tool's Zod schema, so a tool added tomorrow is a
command tomorrow and the two surfaces cannot drift.

```bash
mastodon-cli                                # every command, one line each
mastodon-cli get-home-timeline --limit 50
mastodon-cli post-status --status "..." --confirm
mastodon-cli list-accounts --json | jq -r '.accounts[].handle'
```

`--json`, `--compact` and `--agent` control the output; `--select a,b.c` keeps
only the fields you asked for, which is what makes a long timeline affordable.
`--confirm` is the shell spelling of the `confirm: true` the MCP surface takes,
enforced by the same `WriteGuard`. Exit codes are 0, 2 usage or a refused write,
3 not found, 4 auth, 5 API, 7 rate limited, 10 nothing configured, so a script
branches on a number instead of parsing prose.

Four things the first cut of the adapter got wrong, all fixed here:

- **Nothing configured exited 4, not 10.** The "no account configured" message
  mentions a token, and the auth pattern matched it first, sending someone who
  had configured nothing off to look for an expired credential. Config is now
  tested before auth, and only when there is no HTTP status, so a real 401 still
  exits 4.
- **A refused write exited 5.** A write that stops for want of `--confirm` is
  the caller's to fix by re-running, not an upstream fault. It exits 2.
- **An enum inside an array demanded JSON.** `--types mention` was rejected in
  favour of `--types '"mention"'`. Enum elements are scalars now.
- **`doctor` and `login` were rejected as unknown commands.** They belong to the
  entry point rather than the tool list, and they are the first things typed
  when nothing works yet. An entry-command set makes them reachable from the CLI
  binary.

### Renamed to `mastodon-mcp-cli`

The repo and the package are `mastodon-mcp-cli`, because the package is no
longer only an MCP server. The binaries are unchanged: `mastodon-mcp` is the
server, `mastodon-cli` is the shell surface, and `~/.mastodon-mcp/accounts.json`
stays where it is so an existing login keeps working.

`@thenavidm/mastodon-mcp` is deprecated and points at the new name.

Every GitHub link also moved from the old account to `thenavidm`. npm serves
whatever was in the published tarball, so fixing GitHub did not fix the package
page; this release is what corrects it.

### A Claude Desktop extension

`desktop-extension/` builds a `.mcpb` that installs on a double click, with the
instance URL, the access token and a read-only switch as `user_config` fields.
It vendors its dependencies, so it asks for nothing to be present first.

### Smaller

`VERSION` is read from `package.json` instead of being a second copy in
`server.ts`, which had already drifted: the extension bundle reported 1.0.0
while the package said otherwise. CI now compares the handshake's tool count
against `ALL_TOOLS.length` rather than a number typed into the workflow, so
adding a tool cannot leave a stale literal behind.

---

## 1.0.0

First release. TypeScript, 76 tools.

### Three things Mastodon does differently

**The character limit is per instance.** Verified live: mastodon.social allows
500, infosec.exchange allows 11,000 and ten poll options. `/api/v2/instance` is
read once per instance and cached, so a legal 2,000-character post is accepted
where it is legal and refused with the actual number where it is not.

Mastodon also does not count characters the way `String.length` does. A URL
always counts as 23 however long it is, and the domain half of a remote mention
is free. Both rules are implemented, so a link-heavy status is not refused for
being over a limit it is not over.

**A status body is HTML.** Mastodon deliberately truncates the visible text of a
long link with `invisible` and `ellipsis` spans, so stripping the tags leaves
`navid.me/x/very/lo` and throws the real URL away. Mentions carry only the local
username, so a local alice and a remote alice are indistinguishable without the
status's mention list, and replying to the wrong one is a real mistake to make.
Converted to markdown here, with every link target taken from `href` and mentions
rebuilt into full `@user@instance` handles.

**Posts can be edited.** `PUT /api/v1/statuses/:id`, plus `/source` for the
original text and a public `/history`. The post keeps its boosts, replies and
favourites, so `edit_status` is almost always better than delete-and-repost.

### Setup is one command

`mastodon-mcp login <instance>` registers the application, runs OAuth against a
loopback redirect, verifies the token and stores it mode 0600. Mastodon has no
central developer portal: every instance is its own OAuth provider, and
`POST /api/v1/apps` is unauthenticated precisely so a client can register itself.

`doctor` then checks the granted scopes explicitly, because a read-only token
passes every other check and fails on the first post with a 403 that never
mentions scopes.

### Several accounts, several instances

An account is a token plus an instance, so the same username on two servers is
two different people. `MASTODON_ACCOUNTS`, or `login` run more than once. Every
tool that acts as someone takes an `account`. A name that could match two
accounts fails and names both rather than guessing.

### Output

Tagged text instead of raw JSON. Measured on five real trending statuses from
mastodon.social: 3,815 characters against 26,439, roughly 950 tokens instead of
6,600. A boost wraps the original rather than flattening it, a content warning is
an attribute rather than hidden text, media with no alt text is flagged, and a
thread's reply tree is rebuilt from `in_reply_to_id` rather than handed over as
two flat arrays.

### Pagination

Mastodon returns no cursor in the body, only a `Link:` header carrying `max_id`.
Every listing follows it, so a `limit` of 200 returns 200 rather than one page
of 40.

### Tools

76, across posting, editing, five timelines, hashtags, lists, conversations,
notifications, the graph and moderation. Every action has its inverse.

### Safety

`post_status`, `post_thread`, `edit_status`, `delete_status`, `update_profile`,
`vote_poll`, `report`, `block_account`, `block_domain`, `clear_notifications` and
`delete_list` need `confirm: true`. A poll vote cannot be withdrawn; a report
reaches human moderators. `MASTODON_READ_ONLY=1` leaves 39 read tools and hides
every write. `MASTODON_AUDIT_LOG` records every attempted write, mode 0600.

### Reliability

Per-instance limits cached. 429 and 5xx retried with jittered backoff honouring
Mastodon's real `X-RateLimit-Reset`, which is an ISO timestamp rather than a
number of seconds. Per-request timeout, and a minimum interval between requests.
Media uploads polled until the instance finishes processing, because attaching an
unprocessed id fails with a 422 that does not explain itself.
