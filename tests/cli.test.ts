/**
 * The two surfaces, now that Slipway builds both from ALL_TOOLS.
 *
 * Parsing, help and the exit-code contract are Slipway's and tested there. What
 * matters here: every tool arrives on both surfaces intact, the guard behaves as
 * the README promises, Mastodon's own errors keep their exit codes, login and
 * logout stay reachable, and the docs stay in step with the code.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { EXIT, toSlipwayError } from "@thenavidm/slipway";
import { checkApp, cli, connect } from "@thenavidm/slipway/testing";
import { errorFor, MastodonError } from "../src/api/errors.js";
import { app } from "../src/app.js";
import { ALL_TOOLS } from "../src/tools/index.js";

const env = {};

describe("Mastodon on Slipway", () => {
  it("offers every tool as a command and over MCP, under the same names", async () => {
    const list = await cli(app, [], { env });
    for (const tool of ALL_TOOLS) expect(list.stdout).toContain(tool.command);

    const mcp = await connect(app, { env });
    const names = (await mcp.listTools()).map((tool) => tool.name).sort();
    await mcp.close();
    expect(names).toEqual(ALL_TOOLS.map((tool) => tool.name).sort());
  });

  it("refuses to post without --confirm, before anything reaches the network", async () => {
    const run = await cli(app, ["post-status", "--status", "hello"], { env });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr).code).toBe("refused");
    expect(run.stderr).toContain("--confirm");
  });

  it("hides every write when MASTODON_READ_ONLY is set", async () => {
    const mcp = await connect(app, { env: { MASTODON_READ_ONLY: "1" } });
    const tools = await mcp.listTools();
    await mcp.close();
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("reports a missing argument by its flag and exits 2", async () => {
    const run = await cli(app, ["get-status"], { env });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr).error).toContain("--id");
  });

  it("keeps login and logout reachable from the CLI", async () => {
    const help = (await cli(app, ["--help"], { env })).stdout;
    expect(help).toContain("mastodon-cli login <instance>");
    expect(help).toContain("mastodon-cli logout <handle or instance>");
    expect((await cli(app, ["login", "--help"], { env })).stdout).toContain("Usage: mastodon-cli login <instance>");
    expect((await cli(app, ["login"], { env })).code).toBe(2);
    const logout = await cli(app, ["logout"], { env });
    expect(logout.code).toBe(2);
    expect(logout.stderr).toContain("Usage: mastodon-cli logout");
  });

  /**
   * The README sends people to plain `doctor` for the scope check, so it asks
   * the instance without --network. An instance that never answered used to
   * pass as reachable on the fallback limits, and was told to sign in again.
   */
  it("asks the instance on plain doctor, and calls a silent one unreachable", async () => {
    // The config reads process.env itself, so the variables go there for this one run.
    vi.stubEnv("MASTODON_URL", "http://127.0.0.1:9");
    vi.stubEnv("MASTODON_ACCESS_TOKEN", "x");
    vi.stubEnv("MASTODON_MAX_RETRIES", "1");
    const run = await cli(app, ["doctor", "--json"], { env: {} }).finally(() => vi.unstubAllEnvs());
    const checks = JSON.parse(run.stdout).checks as Array<{ name: string; ok: boolean; fix?: string }>;
    const reachable = checks.find((check) => check.name.endsWith("reachable"));
    expect(reachable).toMatchObject({ ok: false });
    expect(reachable?.fix).not.toContain("login");
    expect(checks.some((check) => check.name === "Network")).toBe(false);
  });

  it("passes slipway check", async () => {
    const report = await checkApp(app, { env });
    expect(report.findings.filter((finding) => finding.level === "error")).toEqual([]);
  });
});

describe("Mastodon's errors keep their exit codes", () => {
  it.each([
    [401, EXIT.auth],
    [403, EXIT.auth],
    [404, EXIT.notFound],
    [422, EXIT.usage],
    [429, EXIT.rateLimited],
    [503, EXIT.api],
  ])("maps HTTP %i from the instance", (status, code) => {
    expect(toSlipwayError(errorFor(status, "/api/v1/statuses", "https://mastodon.example", "")).exitCode).toBe(code);
  });

  /**
   * "No Mastodon account configured..." names a token, so matching auth first
   * sent someone who had configured nothing looking for an expired credential.
   */
  it("calls an unconfigured server config, not auth", () => {
    const message =
      "No Mastodon account configured. Run `mastodon-mcp login <your-instance>` to register an app and sign in, or set MASTODON_URL and MASTODON_ACCESS_TOKEN.";
    expect(toSlipwayError(new Error(message)).exitCode).toBe(EXIT.notConfigured);
  });

  it("calls an instance that never answered an API failure, which a script may retry", () => {
    const down = new MastodonError("Could not reach https://mastodon.example: fetch failed. Instances are individually operated and go down.", 0, "/api/v1/statuses", "https://mastodon.example");
    expect(toSlipwayError(down).exitCode).toBe(EXIT.api);
  });
});

describe("documentation stays in step with the code", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf-8");
  const names = (text: string): Set<string> => new Set(text.match(/MASTODON_[A-Z_]+/g) ?? []);
  const source = (dir: string): string =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? source(`${dir}${entry.name}/`) : entry.name.endsWith(".ts") ? read(`${dir}${entry.name}`) : ""))
      .join("\n");

  /** Every variable the server reads: this repo's code, and Slipway's as agent-context lists them. */
  const used = async (): Promise<Set<string>> => {
    const context = JSON.parse((await cli(app, ["agent-context"], { env })).stdout);
    return new Set([...names(source("../src/")), ...context.settings.map((setting: { env: string }) => setting.env)]);
  };

  /**
   * Four variables shipped undocumented and seven never reached `--help`, which
   * is the kind of drift nobody notices because both sides look complete on
   * their own.
   */
  it("documents every environment variable the server reads", async () => {
    const documented = names(read("../README.md"));
    expect([...(await used())].filter((v) => !documented.has(v))).toEqual([]);
  });

  it("lists every environment variable in --help", async () => {
    const help = (await cli(app, ["--help"], { env })).stdout;
    // The help groups the three HTTP ones as `MASTODON_HTTP_PORT / _HOST / _TOKEN`.
    const shorthand = new Set(["MASTODON_HTTP_HOST", "MASTODON_HTTP_TOKEN"]);
    expect([...(await used())].filter((v) => !help.includes(v) && !shorthand.has(v))).toEqual([]);
  });

  /**
   * Two in-page links pointed at headings that had been renamed, including the
   * one row routing a shell user to the CLI. The ship checklist's link pass only
   * greps http, so a dead `#anchor` is the kind that ships quietly.
   */
  it.each(["../README.md", "../INSTALL.md"])("has no dead in-page anchors in %s", (file) => {
    if (!existsSync(new URL(file, import.meta.url))) return; // repo may ship one doc
    const md = read(file);
    const slugs = new Set<string>();
    for (const [, heading] of md.matchAll(/^#{2,4} (.+)$/gm)) {
      const stripped = (heading as string).toLowerCase().replace(/[^\w\s-]/g, "");
      // GitHub keeps the trailing hyphen when a heading ends in an emoji.
      slugs.add(stripped.trim().replace(/\s+/g, "-"));
      slugs.add(stripped.replace(/\s+/g, "-"));
    }
    const dead = [...md.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)]
      .map((m) => m[1] as string)
      .filter((a) => !slugs.has(a));
    expect(dead).toEqual([]);
  });
});
