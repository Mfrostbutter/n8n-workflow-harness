# The build loop

The sequence, in order, and what each step catches. Skipping a step does not
usually fail loudly; it fails later.

```
drift-check → export-all + commit → design → configure → validate →
deploy → read connections back → execute → verify → promote → verify again
```

## 0. Before you touch anything

```bash
./scripts/drift-check.sh dev
./scripts/export-all.sh dev
git add -A && git commit -m "baseline before <change>"
```

**Why in that order.** `export-all` gives you a rollback point. It is only a
rollback point if the repo and the instance agreed when you took it. Export
first without drift-checking and you may be committing someone else's
undocumented hotfix as if it were your baseline, then "rolling back" to a state
that never existed.

`drift-check` exits 1 on real drift. It ignores canvas positions, ids,
timestamps, pinned data, and sticky notes; it reports parameters, connections,
credentials, `typeVersion`s, disabled nodes, and active state. A moved node is
not drift. A changed parameter is.

## 1. Design

Check templates before building from scratch. There are 2,700+, and a template
that is 70% right is a better starting point than a blank canvas.

```
search_templates({searchMode: "by_task", task: "webhook_processing"})
search_templates({searchMode: "by_metadata", complexity: "simple"})
```

Then pick the architecture. `n8n-workflow-patterns` owns this decision. State
the trigger, the error path, and the output shape before writing nodes. A
workflow with no error path is not finished, it is a draft that has not failed
yet.

## 2. Configure

**`get_node` before setting any parameter.** Every time, for every node.

```
get_node({nodeType: "nodes-base.set", detail: "standard"})
```

Start with `detail: 'standard'` (1–2 KB, shows required fields). Use `'full'`
only when standard is insufficient; it can exceed 100 KB.

This is not ceremony. n8n's node surface moves between releases, and the model's
training data does not. Writing this doc, the live schema returned
`typeVersion: 3.5` for the Set node where 3.4 was the plausible guess. That
mismatch is the kind of thing that validates, deploys, and then behaves
differently than intended.

Never trust a default. Explicitly set every parameter that controls behaviour;
unstated defaults are the most common source of runtime surprises.

## 3. Validate

```
validate_node({nodeType: "...", config: {...}, mode: "minimal"})   # required fields
validate_node({nodeType: "...", config: {...}})                   # full
validate_workflow({workflow: {...}})                              # whole thing
```

`n8n-validation-expert` knows which warnings are false positives and which
errors are real. Do not silence a warning you have not understood.

Offline, without any MCP call:

```bash
./scripts/validate.sh workflows/dev/my-workflow.json
```

## 4. Deploy to dev

```
n8n_create_workflow({...})
n8n_update_partial_workflow({...})   # prefer the diff for an existing workflow
```

Dev only. Promotion is step 8.

## 5. Read the connections back

**This is the step people skip, and it is the one that catches the most.**

```
n8n_get_workflow({id: "...", mode: "full"})
```

Then actually look at the `connections` object. `validate_workflow` passing means
the JSON is well-formed. It does not catch:

- a wire that was silently dropped on write
- a Merge node input off by one, so branch B lands on input 1 instead of 2
- an error output configured but never connected, so failures vanish
- a node connected to the wrong output index of an IF or Switch

All four produce a workflow that validates, deploys, and does the wrong thing.

## 6. Execute it

```
n8n_test_workflow({...})
n8n_executions({action: "list", limit: 5})
n8n_executions({action: "get", id: "..."})
```

**A 200 is not proof.** The API accepting a write says the write parsed, not
that the workflow does what you meant. Read the execution data and check the
output shape against what you designed in step 1.

For a webhook, the trap is `$json.body`: the payload arrives nested, not at the
top level. `n8n-expression-syntax` covers it.

## 7. Verify

Before calling it done:

- [ ] The execution produced the output shape you designed
- [ ] The error path was exercised, not just the happy path
- [ ] `connections` matches the intended graph
- [ ] No secret is in a node parameter, a Set node, or a Code node
- [ ] `./scripts/drift-check.sh dev` is clean, or the repo has been re-exported
- [ ] The workflow JSON is committed

Then export and commit:

```bash
./scripts/export-all.sh dev
git add -A && git commit -m "add <workflow>: <what it does>"
```

## 8. Promote

Through your agreed release path: git-backed environment sync, a reviewed
export/import, or whatever the instance owner mandates. **Not** an ad-hoc API
write from a build session.

```bash
./scripts/drift-check.sh prod     # know what you are changing before you change it
```

## 9. Verify again on the target

Everything in step 7, against the promoted environment. Credentials, folder
placement, and environment variables differ between environments, so a workflow
that is correct on dev can be wrong on prod for reasons that have nothing to do
with its logic.

Activation deserves its own note: activating caches the trigger registration. An
edit made after activation may not reach the running trigger. If a change to a
live workflow appears to do nothing, that is the first thing to check
(`n8n-gotchas`, and [09-TROUBLESHOOTING.md](09-TROUBLESHOOTING.md)).

## What the hooks add

The `PreToolUse` hook fires before every instance-mutating call and repeats the
relevant rule: read `connections` back after a write, confirm the target before
a credential write, archive rather than delete, and the activation-cache warning
when a call sets `active: true`. It reminds, never blocks.
