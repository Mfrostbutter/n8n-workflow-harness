# Skills

Twenty skills live in `.claude/skills/`. Claude Code loads project skills
automatically whenever it runs in this directory, so there is nothing to
install.

## How routing works

Skills activate two ways:

1. **By description.** Each skill's frontmatter describes when it applies.
   Claude matches your request against those descriptions. This works well when
   your phrasing overlaps the description and less well when it does not.
2. **By the router.** `using-n8n-mcp-skills` is the entry point. It fires first
   on any n8n task and names the specialist that owns the decision. When in
   doubt it says to load more skills rather than fewer.

Description matching alone is unreliable, which is why this repo also ships a
`SessionStart` hook that injects the contract and points at the router from turn
one. See the Hooks section of the [README](../README.md).

**Load the skill before the action.** A skill read after the failure only
explains it.

## Which skill owns what

| You are about to | Skill |
|---|---|
| Do anything n8n and you are not sure where to start | `using-n8n-mcp-skills` |
| Call any n8n-mcp tool | `n8n-mcp-tools-expert` |
| Choose a workflow's shape | `n8n-workflow-patterns` |
| Set node parameters | `n8n-node-configuration` |
| Write a `{{ }}` expression or map data between nodes | `n8n-expression-syntax` |
| Read a validation error | `n8n-validation-expert` |
| Write a Code node in JavaScript | `n8n-code-javascript` |
| Write a Code node in Python | `n8n-code-python` |
| Write a Code **Tool** an agent will call | `n8n-code-tool` |
| Build an AI agent, classifier, or RAG flow | `n8n-agents` |
| Handle files, binary, base64, attachments | `n8n-binary-and-data` |
| Wire error outputs, retries, an error workflow | `n8n-error-handling` |
| Extract a sub-workflow, or use Execute Workflow | `n8n-subworkflows` |
| Add sticky notes or canvas groups | `n8n-canvas-docs` |
| Deploy, activate, or debug something already live | `n8n-instance-ops` |
| Work out why something "succeeded" and did nothing | `n8n-gotchas` |
| Target the right instance among several | `n8n-multi-instance` |
| Plan environments, RBAC, secrets, scaling, air-gap | `n8n-enterprise-delivery` |
| Stand up or harden n8n itself | `n8n-self-hosting` |
| Package or distribute a custom node | `n8n-node-dev` |

Two are easy to confuse:

- **`n8n-code-javascript` vs `n8n-code-tool`.** The Code *node* returns
  `[{json: {...}}]`. The Code *Tool* (`@n8n/n8n-nodes-langchain.toolCode`,
  attached to an agent) returns a **string**, has no `$input` or `$helpers`, and
  takes its input as `query`. Different node, different sandbox, different
  contract. Using the wrong one produces "Wrong output type returned".
- **`n8n-instance-ops` vs `n8n-self-hosting`.** Ops is for operating a running
  instance. Self-hosting is for deploying the instance itself.

## Where they come from

**Fifteen vendored**, unmodified, from the upstream `n8n-skills` pack (MIT,
Romuald Członkowski): `using-n8n-mcp-skills`, `n8n-mcp-tools-expert`,
`n8n-workflow-patterns`, `n8n-node-configuration`, `n8n-expression-syntax`,
`n8n-validation-expert`, `n8n-code-javascript`, `n8n-code-python`,
`n8n-code-tool`, `n8n-agents`, `n8n-binary-and-data`, `n8n-error-handling`,
`n8n-multi-instance`, `n8n-self-hosting`, `n8n-subworkflows`.

**Five original** to this harness, written from enterprise delivery work:
`n8n-instance-ops`, `n8n-enterprise-delivery`, `n8n-node-dev`, `n8n-gotchas`,
`n8n-canvas-docs` (adapted).

Full credit: [../ATTRIBUTION.md](../ATTRIBUTION.md).

## Editing skills

**Do not hand-edit a vendored skill.** `./scripts/refresh-skills.sh` replaces
all fifteen wholesale, so your edit disappears at the next refresh with no
warning. A change worth keeping goes into one of the five originals, or upstream
as a pull request.

The five originals are yours to edit. Keep the frontmatter `description`
specific: it is the entire basis for description-based activation, so a vague
description means the skill does not fire when it should.

## Vendored, or the upstream plugin?

Upstream distributes the pack as a Claude Code plugin:

```
/plugin install czlonkowski/n8n-skills
```

| | Vendored (this repo) | Upstream plugin |
|---|---|---|
| Needs marketplace access | No | Yes |
| Works offline after clone | Yes | No |
| Tracks upstream automatically | No, `refresh-skills.sh` | Yes |
| Ships upstream's hook layer | No, this repo has its own | Yes |
| Pinned and auditable | Yes | Moves under you |

This repo vendors so it clones and runs in a restricted environment with no
plugin approval. If your environment allows the plugin and you would rather
track upstream, install it and delete the fifteen vendored directories, keeping
the five originals. Then do the dedupe pass below.

## Deduping against the official n8n skills

If you install the official `n8n-io/skills` plugin alongside these, they will
overlap on expressions, node configuration, Code nodes, error handling, and AI
agents. **Two skills firing on the same trigger is worse than either alone**:
they compete for context and can contradict each other.

1. List both packs' skill names and their description triggers side by side.
2. For each overlapping topic pick **one owner**. Default to the official pack
   where they tie, since it tracks the product.
3. Remove the loser rather than editing its body: for a vendored skill, delete
   the directory (it is restored by `refresh-skills.sh`, so record the decision).
4. Write the decision into `CLAUDE.md` under a routing table, so the next
   refresh does not silently undo it.

These five have no official equivalent and stay regardless:
`n8n-instance-ops`, `n8n-gotchas`, `n8n-enterprise-delivery`, `n8n-node-dev`,
`n8n-canvas-docs`.

## Checking what is loaded

```bash
ls .claude/skills                  # 20 directories
./scripts/verify-setup.sh          # confirms all 20 and their SKILL.md files
```

Inside Claude Code, the skill list shows what is available in the session.
