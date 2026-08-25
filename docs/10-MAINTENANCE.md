# Maintenance

Three things drift: the vendored skills, the pinned MCP server, and the n8n
instance itself. Each has a deliberate path.

## Refreshing the vendored skills

```bash
./scripts/refresh-skills.sh --dry-run
./scripts/refresh-skills.sh
git diff --stat
```

Replaces the fifteen upstream skills wholesale from
`czlonkowski/n8n-skills`. Never touches the five originals
(`n8n-instance-ops`, `n8n-enterprise-delivery`, `n8n-node-dev`, `n8n-gotchas`,
`n8n-canvas-docs`).

Pin to a tag instead of `main` when you want a known state:

```bash
./scripts/refresh-skills.sh --ref v1.29.0
```

After a refresh:

1. Read the diff. Upstream sometimes renames or merges a skill.
2. Record the upstream commit (the script prints it) in `ATTRIBUTION.md`.
3. Re-run `./scripts/verify-setup.sh` — the skill count should still be 20.
4. Commit as its own change, not mixed with your work.

**Local edits to vendored skills are destroyed.** That is the design. If you
have been editing one, move the change into an original skill or send it
upstream before refreshing.

If upstream has restructured and a skill the script expects is gone, it fails
with the list rather than silently leaving you short. Refresh by hand and update
`ATTRIBUTION.md` and the tables in `README.md` and `04-SKILLS.md`.

## Bumping the MCP server

Both servers run one pinned package, so one edit moves both.

```bash
npm view n8n-mcp version                    # what is current
npm view n8n-mcp@latest engines             # Node requirement
```

Then edit both `args` arrays in `.mcp.json`:

```json
"args": ["-y", "n8n-mcp@2.74.0"]
```

Restart Claude Code (the server's version is fixed at spawn) and verify:

```
tools_documentation()     # tool count and the n8n version it is tested against
n8n_health_check()        # your instance's actual version
```

Update the pin in `ATTRIBUTION.md` and `03-MCP-SERVERS.md` in the same commit.
Bump the server and the skills together when you can: the skills describe the
server's tools, and a large gap between them is where "the skill names a tool
that does not exist" comes from.

**Why pinned at all.** `npx -y n8n-mcp` resolves to whatever is newest at spawn.
Two engineers on the same repo would get different tool surfaces, and a bug
would be unreproducible. Pinning makes the version a reviewed change.

## When n8n itself is upgraded

The instance moves independently of this repo, and that is the most common
source of surprise.

After an instance upgrade:

```bash
./scripts/doctor.sh              # version, reachability, API capability
./scripts/drift-check.sh dev     # did the upgrade rewrite anything
```

An upgrade can bump node `typeVersion`s on existing workflows, which surfaces as
drift. That drift is real: decide whether to adopt it (re-export and commit) or
redeploy from the repo.

`tools_documentation` reports which n8n version the pinned server is tested
against. A large gap between that and your instance means schemas may be stale.
Trust the live tool over any skill, and bump the server.

## Networks that block npm

`npx` fetches on first run. Three options when the registry is unreachable:

**Pre-seed the cache** on a machine with access, then move it:

```bash
npm cache add n8n-mcp@2.73.0
# copy ~/.npm to the target machine
```

**Internal registry.** Mirror the package and point npm at it
(`.npmrc` with `registry=https://npm.internal.example.com`). `.mcp.json` needs
no change.

**Docker.** Upstream publishes `ghcr.io/czlonkowski/n8n-mcp`. Replace the
`command`/`args` in `.mcp.json` with a `docker run -i --rm` invocation passing
the same environment variables. Note that pulling the image needs registry
access too.

The toolkit in `scripts/` uses Node built-ins only, so it works with no
registry access at all. In a fully air-gapped environment you keep `doctor`,
`health-check`, `drift-check`, `export-all`, and `validate` even with no MCP
server, which is the point of writing them that way.

## Switching to the upstream plugin

If your environment allows Claude Code plugins and you would rather track
upstream than vendor:

```
/plugin install czlonkowski/n8n-skills
```

Then delete the fifteen vendored directories, keep the five originals, and
delete this repo's `hooks` block from `.claude/settings.json` (the plugin ships
its own enforcement layer, and two overlapping layers is noise). Trade-offs are
tabled in [04-SKILLS.md](04-SKILLS.md#vendored-or-the-upstream-plugin).

## Keeping the harness honest

Cheap and worth running on a schedule:

```bash
./scripts/verify-setup.sh                                    # offline
node --test tests/tools.test.mjs tests/instance.test.mjs     # 44 tests
./scripts/doctor.sh                                          # instance
./scripts/drift-check.sh dev                                 # repo vs reality
```

`drift-check` exits 1 on drift, so it belongs in CI or a pre-push hook if you
want the repo's source-of-truth claim enforced rather than asserted.

## Changing the rules

`CLAUDE.md` is the operating contract, loaded every session. It is the right
place for a rule your team keeps having to repeat: a naming convention, an
approved node list, a change window, a promotion approver.

Keep it short. It is loaded into every session, so length is a real cost, and a
contract nobody reads is worse than a short one everybody does.

The hooks in `.claude/hooks/` are the enforcement surface. `session-context.md`
is plain markdown injected at session start, so editing it needs no code. Both
hooks must keep failing open: a hook that blocks on error will strand someone
mid-build.
