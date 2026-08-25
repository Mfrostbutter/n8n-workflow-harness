# Attribution

This harness stands on open-source work by others. Keep this file, and the
credit in it, when the repo or the skills are copied, shared, or quoted.

## n8n-mcp and the n8n-skills pack

Both MCP servers in `.mcp.json` are the **n8n-mcp** package, and fifteen of the
twenty skills in `.claude/skills/` are the **n8n-skills** pack. Both are by
**Romuald Członkowski**, both MIT licensed:

| Component | Upstream | License |
|---|---|---|
| `n8n-mcp` (both MCP servers) | https://github.com/czlonkowski/n8n-mcp | MIT |
| `n8n-skills` (15 vendored skills) | https://github.com/czlonkowski/n8n-skills | MIT |

Pinned version: `n8n-mcp@2.73.0`. Full license text in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

The fifteen vendored skills, carried in unmodified:

`using-n8n-mcp-skills` (router), `n8n-mcp-tools-expert`,
`n8n-workflow-patterns`, `n8n-node-configuration`, `n8n-expression-syntax`,
`n8n-validation-expert`, `n8n-code-javascript`, `n8n-code-python`,
`n8n-code-tool`, `n8n-agents`, `n8n-binary-and-data`, `n8n-error-handling`,
`n8n-multi-instance`, `n8n-self-hosting`, `n8n-subworkflows`.

**Why they are vendored rather than installed.** Upstream ships this pack as a
Claude Code plugin (`/plugin install czlonkowski/n8n-skills`), which is the
better path when you have plugin-marketplace access and want to track upstream.
This repo vendors instead so it clones and runs with no marketplace access, no
plugin approval, and no network beyond npm. If you can use the plugin, do:
see [docs/10-MAINTENANCE.md](docs/10-MAINTENANCE.md).

**Do not hand-edit a vendored skill.** Local edits are lost on the next refresh
(`./scripts/refresh-skills.sh`). A change worth keeping belongs either in one of
the original skills below, or upstream as a pull request.

If you sponsor tools you depend on: https://github.com/sponsors/czlonkowski

## Skills original to this harness

Five skills are written from field experience delivering n8n to enterprise
customers, and have no upstream equivalent:

| Skill | Covers |
|---|---|
| `n8n-instance-ops` | Deploying to a live instance: activation cache, API allowlist, export/import, webhook reachability, encryption key |
| `n8n-enterprise-delivery` | Environments and source control, RBAC, external secrets, scaling, licensing and air-gap, multi-tenancy, promotion |
| `n8n-node-dev` | Custom node packaging and distribution, the every-worker rule, air-gapped install, verified nodes |
| `n8n-gotchas` | Field-discovered behaviors that report success and do nothing |
| `n8n-canvas-docs` | Sticky notes and canvas groups, sizing math, layout checker (adapted) |

## n8n itself

n8n is a product of n8n GmbH: https://n8n.io. This harness is not an official
n8n product and carries no warranty from n8n GmbH. n8n's own supported tooling
(instance-level MCP, the `n8n-io/skills` plugin) takes priority where it
overlaps; see [docs/03-MCP-SERVERS.md](docs/03-MCP-SERVERS.md).
