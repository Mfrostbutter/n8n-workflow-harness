# Prompt recipes

The harness supplies the schemas and the rules. You still have to say what you
want. These are patterns that produce workflows you can ship.

## What makes a prompt work

A good n8n prompt names five things:

1. **Trigger** — webhook, schedule, manual, another workflow
2. **Data shape** — what arrives, and what leaves
3. **Failure behaviour** — what happens when a step fails
4. **Credentials** — by name, never by value
5. **Boundaries** — target environment, whether to activate

Miss any of those and Claude guesses. It usually guesses plausibly, which is
worse than guessing badly, because plausible wrong survives review.

### Too vague

> Build me a workflow that syncs Salesforce to Postgres.

No trigger, no field mapping, no error path, no credentials, no volume. What
comes back will look right and be wrong in ways you find in production.

### Specific enough to ship

> Build a scheduled workflow, every 15 minutes, that pulls Salesforce
> Opportunities modified since the last run, maps `Id`, `Name`, `Amount`,
> `StageName`, and `LastModifiedDate` to the `opportunities` table in Postgres,
> and upserts on `Id`. Use credentials `sf-dev` and `pg-dev-crm`. Track the
> watermark in workflow static data. On a Postgres failure, retry twice, then
> route to the error output and post the failing batch to the
> `#data-alerts` Slack channel via `slack-dev`. Expect ~500 records per run.
> Build on dev, do not activate, and show me the connections before we deploy.

## Recipes

### Start a build

> Read CLAUDE.md. I want to build <one sentence>. Before writing anything:
> check `search_templates` for something close, tell me which pattern from
> `n8n-workflow-patterns` fits, and list the nodes you intend to use with the
> `typeVersion` each one reports from `get_node`. Do not create the workflow
> until I confirm the plan.

Forces design before code, and surfaces version drift before it is baked in.

### Review a workflow you did not write

> Read `workflows/dev/<file>.json`. Do not change it. Tell me: what triggers it,
> what it does step by step, what happens when each external call fails, any
> secret in a node parameter rather than a credential, and any node whose
> `typeVersion` is behind what `get_node` reports. Rank findings by blast radius.

### Debug "it succeeded but nothing happened"

> This workflow reports success and produces no result: <id or file>. Load
> `n8n-gotchas` first. Then check, in this order: is the deployed graph the same
> as the draft (`n8n_get_workflow` mode 'active' vs 'full'), was it edited after
> activation, are error outputs wired, and does the last node actually return
> data. Show me the most recent execution before you theorise.

Names the failure class and the order to check, so you do not get a guess.

### Add error handling to something that has none

> Add error handling to <workflow>. Load `n8n-error-handling` first. Every
> external call gets `retryOnFail` where a retry is safe and an error output
> where it is not. Route all error outputs to a single notification node using
> `slack-dev`. Webhook responses: 400 on validation failure with the field list,
> 502 on an upstream failure. Show me the connections object when you are done
> so I can confirm nothing is unwired.

### Write a Code node

> I need a Code node that <transformation>. Load `n8n-code-javascript` and call
> `tools_documentation({topic: "javascript_code_node_guide"})` first. Input is
> <shape>, output must be <shape>. Handle an empty input array. Use
> `this.helpers` if you need HTTP, and tell me if the HTTP Request node would be
> the better choice.

### Build an AI agent

> Build an AI agent that <task>. Load `n8n-agents` first. Tell me whether this
> should be an Agent, an LLM Chain, or a Text Classifier and why, before
> building. For each tool, give me the name and description you will use, since
> those are the prompt. Specify the memory type and how `sessionId` is derived.
> If the output must be structured, use an output parser with autoFix.

### Promote

> `workflows/dev/<file>.json` is ready for staging. Run `drift-check` on both
> dev and staging first and show me the output. List every difference between
> the environments that affects this workflow: credential names, folder, env
> vars, webhook path. Do not write to staging until I confirm.

### Document the canvas

> Add sticky notes to <workflow> explaining each zone. Load `n8n-canvas-docs`
> first. No overlapping stickies, no truncated text, and run the construction
> checker before showing me the result.

## Habits worth keeping

**Say "do not activate".** Otherwise you may get a live workflow before you
have read it.

**Ask for the connections object.** "Show me the connections" is the cheapest
review you can run, and it catches the failure class validation misses.

**Ask what it did not do.** "What did you skip, assume, or leave unverified?"
surfaces the quiet gaps.

**Push back on plausible.** If a `typeVersion` or parameter looks invented, ask
for the `get_node` output. The rule is configure from the live schema, and it is
worth enforcing.

**Start a fresh session for a new workflow.** Setup output and a previous
build's context compete with the current one.

## Anti-patterns

| Don't | Why |
|---|---|
| "Just make it work" | You get something that runs, not something correct |
| Paste a real API key | It is in the transcript forever. Use a credential name |
| "Fix all the workflows" | No blast-radius control. One at a time |
| Ask it to build straight on prod | The instance owner's release path exists for a reason |
| Accept a workflow you have not read | You own it once it is deployed |
| "Ignore the validation warning" | Understand it first; some are false positives, some are not |
