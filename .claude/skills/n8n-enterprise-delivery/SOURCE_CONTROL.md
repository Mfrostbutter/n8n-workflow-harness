# Source control: sync payload, branches, conflicts

Reference depth for the environments section of `SKILL.md`.

## What the sync carries

**What the sync carries:**

- Workflows (JSON), with tags and owner email. Note: the **saved** version, not
  the published one. What you see on the canvas is what pushes.
- Credential **stubs**: id, name, type, plus any expression-based fields. Never
  the secret values.
- Variable **stubs**: id and name only, never values.
- Data table **schemas**: table names and column definitions. **Row data does not
  sync.** Seeding a data table is environment setup, not promotion.
- Projects and folders.

You choose which workflows and data tables to include. Tags, variables, and
credential stubs go automatically.

**What it does not carry:** credential values, variable values, data table rows,
execution history, instance config, encryption key.

## Branch patterns

Two supported shapes. Pick one on day one and write it into the handoff.

**Multi-instance, multi-branch.** Each instance is bound to its own branch. Dev
pushes to the dev branch, a pull request merges dev into production, production
pulls. Buys you PR review as the gate before production. Costs manual steps per
promotion. This is the default recommendation for a customer with a change
process.

**Multi-instance, single-branch.** Every instance is bound to the same branch,
usually main. A push from one instance is immediately pullable by the others. Buys
speed. Costs the review gate, and an accidental push reaches production's branch
with nothing in between.

Two rules that hold in both:

- **Work flows one direction per instance.** An instance either pushes or pulls,
  not both. n8n says this explicitly, and the reason is that workflow conflicts
  are not detected (below).
- **Set production to protected instance.** It blocks workflow editing there, so
  the canvas cannot become the source of truth by accident.

## Conflict behavior

This is the part that loses work if you assume git semantics.

- **Workflows: no conflict detection at all.** There is no merge. On pull, git
  wins and n8n warns that it is overriding local changes. On push, your instance
  wins and overwrites git. Coordination is procedural; nothing enforces it.
- **Credentials and variables: resolved automatically**, no prompt. On pull,
  existing items are left alone unless the variable was set externally, the
  credential name changed, or a tag was renamed. On push, n8n overwrites the whole
  variables and tags files.
- **Tags: git wins on pull.** Avoid renaming tags; names are unique and a rename
  propagates as an overwrite.

## Deletions and divergence

- Deleted workflows, credentials, and variables are **not** removed locally on
  pull. n8n notifies and asks for confirmation.
- Deleted **data tables are** removed locally on pull, after a confirmation dialog
  listing them. Removing a column destroys that column's data and cannot be
  undone; n8n warns first.
- Auto-publish on pull is a dropdown: `Off`, `If Already Published`, `On`. Pulling
  a published workflow unpublishes and republishes it, so there are a few seconds
  where it is not live. Promote in a window, not at peak.

`N8N_SOURCECONTROL_DEFAULT_SSH_KEY_TYPE` defaults to `ed25519`. Set it to `rsa`
only if the customer's git host rejects ed25519.

## Promotions versus source control (added 2026-10-19)

Promotions (n8n 2.40, licensed, `n8n-cli promotion-provider` and
`promotion-connection`) reuse the Git-repository idea but change four things:

1. **Scope.** A connection is `instance`-wide or `projects`-scoped, and a
   project links to exactly one connection. That is the per-project git
   isolation source control never had.
2. **Direction is explicit.** `promote` exports and pushes; `apply` resets the
   checkout to the branch tip and imports. Each direction is cloned separately
   on the instance that uses it.
3. **The apply is reviewable.** `list-changes <projectId> apply` returns the
   commit SHA; `apply --expected-config-id --expected-branch
   --expected-commit-sha` imports only that commit. Exit 3 means the branch
   moved since the review; exit 4 means preflight found missing credential or
   variable bindings, access requirements, or conflicts. Nothing is imported
   on either.
4. **Remapping is built in.** Apply runs the package import path, so
   credential and data-table bindings, create-stub, and matching modes apply.

What did not change: credential values, variable values and data-table rows
never travel; the published version is what packages carry under
`published-strict`, where source control pushed the saved draft. Since 2.41.0
the package keeps `versionId` in `workflow-metadata.json`, so a publish no
longer dirties the content file.

No docs.n8n.io page covers Promotions as of 2026-10-19; the CLI's own docs
(`packages/@n8n/cli/docs/commands/promotions.md` and `guides/ci-cd.md` in the
n8n monorepo) are the reference. Record the n8n version and CLI version used in
the handoff.

