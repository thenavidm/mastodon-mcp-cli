/**
 * The Mastodon app: everything Slipway needs to ship the MCP server and the CLI.
 *
 * This file only describes. It never starts anything, so `slipway check` and
 * tests can import it; `index.ts` is what runs.
 */

import { createRequire } from "node:module";
import { slipway, type DoctorCheck } from "@thenavidm/slipway";
import { MastodonClient } from "./api/client.js";
import { MastodonError } from "./api/errors.js";
import { instanceLimits } from "./api/instance.js";
import { removeAccount, storePath } from "./auth/store.js";
import { loadConfig } from "./config.js";
import { INSTRUCTIONS, PROMPTS, RESOURCES } from "./guide.js";
import { ALL_TOOLS } from "./tools/index.js";
import { makeContext, type ToolContext } from "./tools/kit.js";

const require = createRequire(import.meta.url);
export const VERSION: string = (require("../package.json") as { version: string }).version;

const loginHint = (instance: string) => `Run \`mastodon-cli login ${instance.replace(/^https?:\/\//, "")}\`.`;

/**
 * The checks below ask the instance on every `doctor` (`doctorNetwork`). The
 * failure people actually hit on Mastodon is a token missing the `write` scope: reads work, so
 * everything looks fine, and then the first post fails with a 403 that says
 * nothing about scopes. So the scopes are checked per account, and named.
 */
async function doctor(ctx: ToolContext, options: { network: boolean }): Promise<DoctorCheck[]> {
  const { client, config } = ctx;
  const checks: DoctorCheck[] = [];
  if (config.accounts.length) {
    checks.push({ name: "Accounts", ok: true, detail: config.accounts.map((a) => `${a.handle || "(unverified)"} on ${a.instance}`).join(", ") });
  }
  if (config.preferred.length) checks.push({ name: "Default account", ok: true, detail: config.preferred.join(", ") });
  if (!options.network) return checks;

  for (const account of config.accounts) {
    const who = account.handle || account.instance;
    try {
      const limits = await instanceLimits(client, account);
      // The limits fall back to 500 characters when the instance never answers, which is no proof it is up.
      if (!limits.answered) {
        checks.push({
          name: `${account.instance} reachable`,
          ok: false,
          detail: "Neither /api/v2/instance nor /api/v1/instance answered.",
          fix: "Check the address. Instances are run by people and go down, so try again later.",
        });
        continue;
      }
      checks.push({
        name: `${account.instance} reachable`,
        ok: true,
        detail: `${limits.title}, ${limits.version}, ${limits.maxCharacters} characters, ${limits.maxMediaAttachments} attachments, ${limits.maxPollOptions} poll options`,
      });
      if (!limits.looksLikeMastodon) {
        checks.push({
          name: `${account.instance} is not Mastodon itself`,
          ok: true,
          warn: true,
          detail: `Reports "${limits.version}". The API is compatible, but edits, polls or trends may be missing.`,
        });
      }
    } catch (error) {
      checks.push({ name: `${account.instance} reachable`, ok: false, detail: (error as Error).message });
      continue;
    }

    try {
      const me = await client.call<Record<string, any>>(account, "/api/v1/accounts/verify_credentials");
      checks.push({ name: `${who} sign-in`, ok: true, detail: `@${me.acct}, ${me.followers_count ?? 0} followers, ${me.statuses_count ?? 0} statuses` });
    } catch (error) {
      const status = error instanceof MastodonError ? error.status : 0;
      // Signing in again fixes a token the instance refused, not an instance that did not answer.
      checks.push({
        name: `${who} sign-in`,
        ok: false,
        detail: status === 401 ? "The token was revoked or belongs to another instance." : (error as Error).message,
        ...(status === 401 || status === 403 ? { fix: loginHint(account.instance) } : {}),
      });
      continue;
    }

    try {
      const appInfo = await client.call<Record<string, any>>(account, "/api/v1/apps/verify_credentials");
      const scopes = String(appInfo.scopes ?? "").split(/[\s,]+/).filter(Boolean);
      const granted = scopes.length ? scopes.join(" ") : "(not reported)";
      const canWrite = scopes.some((s) => s === "write" || s.startsWith("write:"));
      const canFollow = scopes.some((s) => s === "follow" || s.startsWith("write:follows"));
      checks.push({
        name: canWrite ? `${who} can post` : `${who} cannot post`,
        ok: canWrite,
        detail: `scopes: ${granted}`,
        ...(canWrite ? {} : { fix: `The token has no write scope, so reads work and the first post fails with a 403. ${loginHint(account.instance)}` }),
      });
      if (canWrite && !canFollow) {
        checks.push({ name: `${who} cannot follow or block`, ok: false, detail: "The token has write but not follow.", fix: loginHint(account.instance) });
      }
    } catch {
      // `/apps/verify_credentials` is Mastodon's own; compatible servers may not
      // have it. Not knowing the scopes is not itself a failure.
      checks.push({ name: `${who} scopes`, ok: true, warn: true, detail: "This server does not report scopes. Posting may still work." });
    }
  }
  return checks;
}

export const app = slipway<ToolContext>({
  name: "mastodon",
  title: "Mastodon",
  version: VERSION,
  package: "@thenavidm/mastodon-mcp-cli",
  description: "posting, editing, threads, timelines, search, hashtags, lists, notifications and the social graph across the fediverse",
  instructions: INSTRUCTIONS,
  context: () => {
    const config = loadConfig();
    return makeContext(new MastodonClient(config), config);
  },
  configured: (ctx) => ctx.config.accounts.length > 0,
  secrets: (ctx) => ctx.config.accounts.map((account) => account.accessToken),
  tools: ALL_TOOLS,
  resources: [
    {
      name: "mastodon-accounts",
      uri: "mastodon://accounts",
      mimeType: "application/json",
      read: (ctx) => ({
        count: ctx.config.accounts.length,
        accounts: ctx.config.accounts.map((a) => ({ handle: a.handle, instance: a.instance })),
        read_only: ctx.config.readOnly,
      }),
    },
    ...RESOURCES.map((resource) => ({ ...resource, read: () => resource.text })),
  ],
  prompts: PROMPTS.map((prompt) => ({ name: prompt.name, description: prompt.description, render: () => prompt.text })),
  doctor,
  // A token without the write scope passes every local check and fails the first post with a 403,
  // so doctor asks the instance every time, as 1.1.3 did.
  doctorNetwork: true,
  login: {
    usage: "login <instance>",
    help: "register an app on that instance and sign in; --oob without a browser, --token=… for a token you made",
    run: async (_io, args) => {
      const { runLogin } = await import("./auth/login.js");
      return runLogin(args);
    },
  },
  commands: [
    {
      name: "logout",
      usage: "logout <handle or instance>",
      help: "forget a stored account; revoke its token on the instance",
      run: (io, args) => {
        const who = args.find((arg) => !arg.startsWith("-"));
        if (!who) {
          io.stderr(`Usage: ${io.bin} logout <handle or instance>\n`);
          return 2;
        }
        const removed = removeAccount(who);
        io.stdout(
          removed
            ? `Removed ${removed} account(s) from ${storePath()}.\nRevoke the token itself at your instance's /oauth/authorized_applications.\n`
            : `Nothing matching "${who}" was stored.\n`,
        );
        return 0;
      },
    },
  ],
  settings: [
    { env: "MASTODON_ACCOUNTS", description: 'Several accounts across instances: [{"instance":"https://mastodon.social","access_token":"…"}].', secret: true },
    { env: "MASTODON_URL", description: "Your instance, for example https://mastodon.social." },
    { env: "MASTODON_INSTANCE_URL", description: "Another name for MASTODON_URL.", tuning: true },
    { env: "MASTODON_API_BASE_URL", description: "Another name for MASTODON_URL.", tuning: true },
    { env: "MASTODON_ACCESS_TOKEN", description: "An access token for that instance.", secret: true },
    { env: "MASTODON_HANDLE", description: "Its full handle. Resolved on first use when absent." },
    { env: "MASTODON_DEFAULT_ACCOUNT", description: "Which handle acts when a tool names none." },
    { env: "MASTODON_REQUEST_TIMEOUT_MS", description: "Per-request deadline. Defaults to 30000.", tuning: true },
    { env: "MASTODON_MIN_REQUEST_INTERVAL_MS", description: "Spacing between requests. Defaults to 120.", tuning: true },
    { env: "MASTODON_MAX_RETRIES", description: "Retries on 429 and 5xx. Defaults to 3.", tuning: true },
    { env: "MASTODON_USER_AGENT", description: "The User-Agent sent to the instance. Defaults to mastodon-mcp.", tuning: true },
    { env: "MASTODON_LOGIN_PORT", description: "The local port `login` listens on for the OAuth redirect. Defaults to 33517.", tuning: true },
    { env: "MASTODON_MCP_HOME", description: "Where `login` stores accounts. Defaults to ~/.mastodon-mcp." },
  ],
  links: { repository: "https://github.com/thenavidm/mastodon-mcp-cli" },
});
