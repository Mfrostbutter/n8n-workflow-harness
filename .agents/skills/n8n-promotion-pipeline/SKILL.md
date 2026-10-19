---
name: n8n-promotion-pipeline
description: >-
  Move n8n workflows between environments the supported way: the official
  @n8n/cli promotion connections (provider, connection, clone, promote,
  list-changes, reviewed-commit apply), .n8np package export and import with
  conflict and binding policies, source-control pull, and the gates that run
  before any of them. Use when the task is to promote dev to staging or prod,
  set up a promotion connection or Git provider, review what differs between a
  project and its branch, apply a reviewed commit, export or import a package,
  wire credential or data-table bindings across instances, build a CI promotion
  job, or decide between native promotion, source-control environments, package
  files and the harness deploy script. Not for building a workflow (authoring
  skills) or editing a live one in place (n8n-instance-ops).
---

# n8n promotion pipeline

Written 2026-10-19 from `@n8n/cli` 0.22.0 (`n8n-cli --help` and the skill the
package ships). The CLI is official (`github.com/n8n-io/n8n`, package
`@n8n/cli`). Re-check the command surface with `npx @n8n/cli@<pin> --help`
when the pin moves; this file is a cache of that output, not the source.

The question this skill answers: a workflow works on dev. How does it reach
production so that a reviewer saw it, the target has what it needs, and
nothing arrives by hand?

## Four ways a workflow moves, and when each is right

| Mechanism | What it is | Use when |
|---|---|---|
| **Promotion connections** (`n8n-cli promotion-*`) | Instance-to-instance through a Git repo. Source instance `promote`s (export, commit, push); target instance `apply`s (reset to branch tip, import). Reviewed-commit apply pins the exact SHA a human reviewed. | Licensed customer with two or more instances and a Git host. The default for an enterprise engagement. |
| **Source control environments** (Settings > Environments; `n8n-cli source-control pull`) | Each instance bound to a branch. Push from dev, PR between branches, pull on prod. The older feature; still the one with the in-product UI. | Customer already runs it, or wants the editor-side push button. One direction per instance. |
| **Packages** (`n8n-cli package export|import`, `.n8np`, beta) | A file carrying selected workflows, folders or projects plus stubs, with explicit conflict and binding policies on import. | Air-gapped targets, one-off migrations, moving a demo into a customer tenant, seeding a tenant from a template set. |
| **Harness deploy** (`scripts/deploy.sh`, public API) | PUT by name with the engagement's credential ledger, tag and canvas gates, read-back verification. | Dev only, and community-licensed instances where none of the above exists. Never the production path on a licensed customer. |

Decide on day one, write it into the engagement `CLAUDE.md` under Promotion
path, and never mix two mechanisms on one target: each assumes it owns the
instance's state.

## What travels and what never does

Same rule for all three product mechanisms:

- Travels: workflow JSON, tags, folders, projects, credential **stubs**
  (id, name, type, expression-valued fields only), variable **stubs** (id,
  name), data table **schemas**.
- Never travels: credential values, variable values, data table rows,
  execution history, the encryption key, instance settings.
- Package export has `--credentialExportPolicy expression-values-only|no-values`
  and `--includeVariableValues`; literal credential values never travel under
  any policy.
- Since n8n 2.41.0 (PR n8n-io/n8n#39091, 2026-09-18) the exported package
  keeps `versionId` and `publishedVersionId` in `workflow-metadata.json`, not
  in `workflow.json`, so a publish no longer dirties the content file.
  Packages exported before that fail metadata validation on import.

Consequence: every target needs its credential values, variable values and
data table rows set up as **environment setup**, before the first apply.
`scripts/lint-workflow.sh` prints the list (the promotion manifest) per
workflow.

## Gates before anything is promoted

Run in this order on the source side. All offline, all in `scripts/`.

1. `drift-check.sh dev` clean: the repo and the instance agree, so what you
   review is what will move.
2. `validate.sh <file>` on every changed workflow: well-formed.
3. `lint-workflow.sh workflows/dev --require-tags`: no environment literal
   hosts, every credential named, no `$env`, tags present, error workflow set,
   and the manifest of credentials and variables the target must already have.
4. `wf-diff.sh <base> <head>` on each changed file: the semantic change a
   reviewer signs off on, not a canvas move.
5. The customer's review: a pull request on the promotion branch, or
   `list-changes` output pasted into the change ticket.

The CI templates in the engagement scaffold run 2 to 4 on every push.

## Promotion connections, end to end

Prerequisites: licensed instance with the promotions module; an API key whose
scopes include `gitConnection:*` (plus `variable:list` for promote when
workflows reference variables); a Git repository the customer owns; the CLI
pinned in the engagement (`npm i --save-exact @n8n/cli@0.22.0`) or run as
`npx @n8n/cli@0.22.0`. Configure with `N8N_URL` and `N8N_API_KEY` from the
engagement `.env`, never flags on the command line.

```bash
# 1. Provider: who may talk to the Git host. SSH returns a deploy key to add.
echo '{"name":"Customer GitLab","type":"git","auth":{"authType":"ssh-key","keyType":"ed25519"}}' \
  | n8n-cli promotion-provider create --stdin --json > provider.json
jq -r '.publicKey' provider.json      # add as a read-write deploy key

# 2. Connection: which repo, which directions.
n8n-cli promotion-connection create --file=connection.json

# 3. Clone each direction you will use. Cloning one does not ready the other.
n8n-cli promotion-connection clone <id> promote     # on the source instance
n8n-cli promotion-connection clone <id> apply       # on the target instance

# 4. Source side: see what differs, then promote.
n8n-cli promotion-connection list-changes <projectId> promote
n8n-cli promotion-connection promote <id> -m "CR-1234: order intake v3"

# 5. Target side: review, then apply exactly the reviewed commit.
n8n-cli promotion-connection list-changes <projectId> apply --sort=updatedAt --order=desc --json > reviewed.json
jq '{commitSha, changes}' reviewed.json
n8n-cli promotion-connection apply <id> \
  --expectedConfigId=$(n8n-cli promotion-connection get <id> --jq '.configs.apply.id') \
  --expectedBranch=$(n8n-cli promotion-connection get <id> --jq '.configs.apply.settings.branchName') \
  --expectedCommitSha=<full sha from reviewed.json>
```

`connection.json` (instance scope; `projects` scope links team projects one
connection each):

```json
{
  "name": "Production",
  "scope": "instance",
  "providerId": "<provider id>",
  "target": { "schemaVersion": 1, "remoteUrl": "git@gitlab.example.com:ops/n8n-flows.git" },
  "configs": {
    "promote": { "settings": { "schemaVersion": 1, "baseBranchName": "main", "createBranchOnPromotion": true } },
    "apply":   { "settings": { "schemaVersion": 1, "branchName": "main" } }
  }
}
```

`createBranchOnPromotion: true` is what gives the customer a pull request:
promote pushes a branch, the PR merges to `main`, prod applies `main`. With
`false`, promote pushes straight to the base branch and the review gate is
gone. Required field either way.

### Exit codes that matter

| Exit | Meaning | Do |
|---|---|---|
| 0 | Applied | Verify with a real execution on the target, then record it |
| 3 | `source-changed`: the branch moved since the reviewed SHA | Review again. Nothing was imported |
| 4 | `blocked`: preflight found missing bindings, access or conflicts | Fix what `--json` lists under `preflight`, then run the printed `apply-continue` with the same three `--expected-*` values. Nothing was imported |

Always pass all three `--expected-*` flags or none. The SHA must be the full
SHA. Check `$?` or the `status` field before reading `counts`.

### Behaviors to design around

- `promote` exports **all team projects** on an instance-scoped connection.
  Use a `projects`-scoped connection when teams must promote independently.
- `apply` **resets the local checkout to the branch tip and overwrites the
  instance** to match. Workflows on the target that the branch does not
  carry are at risk; `apply-selection` removes instance workflows the project
  owns whose ids are absent from the branch. Export the target first
  (`export-all.sh prod` and commit) as the rollback point.
- `--force` on promote overwrites a diverged remote branch. Not in CI.
- `authType: token` means HTTP(S) username and password, not a Git host API
  token. `publicKey` is null for a token provider.
- `set-config` replaces the whole direction configuration; send every setting.
- A project can be linked to one connection only.
- A provider cannot be deleted while a connection uses it.

## Packages

```bash
n8n-cli package export -p <projectId> -o release-2026-10-19.n8np \
  --workflowVersionPolicy published-strict \
  --credentialExportPolicy no-values \
  --missingWorkflowDependencyPolicy fail

n8n-cli package import --file release-2026-10-19.n8np -p <targetProjectId> \
  --workflowConflictPolicy new-version \
  --workflowPublishingPolicy preserve-published-state \
  --credentialMatchingMode name-and-type --credentialMissingMode must-preexist \
  --variableMissingMode must-preexist \
  --dataTableMissingMode create --dataTableSchemaConflictPolicy fail \
  --overwriteDeletionPolicy archive \
  --bindings '{"credentials":{"<sourceId>":"<targetId>"}}'
```

Policies worth stating in the handoff: `published-strict` refuses to export a
workflow that has unpublished changes, so what ships is what runs;
`must-preexist` for credentials and variables turns a missing value into a
failed import instead of a workflow that starts and fails later;
`overwriteDeletionPolicy archive` keeps the archive-not-delete rule.
`--workflowIdPolicy source` keeps ids stable across instances, which is what
makes sub-workflow references survive; `new` is the default and re-mints them.

## Source-control environments

The older model: Settings > Environments binds an instance to a branch, push
from the editor, `n8n-cli source-control pull` on the target (or the UI).
Detail, including the no-conflict-detection rule and the one-direction-per-
instance rule, is in `n8n-enterprise-delivery/SOURCE_CONTROL.md`. Prefer
promotion connections for a new engagement; they carry reviewed-commit apply
and per-project scope, which environments do not.

## CI shape

Source instance, on merge to the promotion branch (or on a schedule):

```
export-all (source) -> commit -> validate + lint + wf-diff on the PR
  -> human review -> promotion-connection promote -m "<ticket>"
```

Target instance, on approval:

```
export-all (target) + commit        # rollback point
  -> list-changes apply --json      # capture commitSha
  -> apply --expected-*             # exit 3 or 4: stop, nothing imported
  -> health-check + a real execution of each changed workflow
```

Secrets in CI: `N8N_URL` and `N8N_API_KEY` per instance as masked variables.
The promotion API key is powerful (`gitConnection:*` plus whatever else it
carries); scope it to the project where the instance supports it, rotate it on
team change, and never reuse the dev key on prod.

## Handoff wording

Under Promotion in the customer's `HANDOFF.md`: the mechanism chosen and why
the other three were not; the connection name, scope, repo and branches; who
reviews and where (PR, ticket); the exact apply command with the three
`--expected-*` flags; what exit 3 and exit 4 mean and who acts; the
environment-setup list (credentials, variables, data table rows) per target;
and the rollback (`export-all` snapshot plus `apply` of the previous SHA).

## Related

- `CLI_REFERENCE.md` in this directory: the command and flag tables for
  `@n8n/cli` 0.22.0, captured verbatim.
- `n8n-enterprise-delivery`: license tiers, RBAC, external secrets, the
  promotion checklist.
- `n8n-workflow-as-code`: making the diff a reviewer sees readable.
- `n8n-instance-ops`: the activation cache, which still applies after an
  apply that republishes a workflow.
