# @n8n/cli 0.27.0 reference

Captured 2026-11-17 from `n8n-cli --help` and per-command help at 0.27.0, the
pin and the npm `latest` tag (1.x is tagged `rc`). History: 0.22.0 cannot
export a package from n8n 2.44.x (`request/body must NOT have additional
properties`); 0.23.0 renamed two package export flags; 0.25.0 replaced the
`promotion-connection` topic with `promotion-environment` (one environment per
direction) and renamed the package import flags. This file holds for the pin
only.
Install: `npm i -g @n8n/cli` or `npx @n8n/cli@0.27.0 <command>`. Binary: `n8n-cli`
(`npx n8n-cli` only where the package is installed: the bare npm name
`n8n-cli` is an unrelated third-party package).
Zero dependencies; talks to the public API. Config resolution: flags
(`--url`, `--apiKey`) > env (`N8N_URL`, `N8N_API_KEY`) > `~/.n8n-cli/config.json`
(mode 0600, written by `n8n-cli login` or `config set-url` / `set-api-key`).

Global flags on every command: `--format table|json|id-only` (JSON when stdout
is piped), `--json`, `--jq '<filter>'` (implies JSON), `--quiet`, `--noHeader`,
`--debug` (HTTP to stderr).

## Topics

| Topic | Commands |
|---|---|
| `workflow` | `list` (`--active`, `--tag`, `--name`, `--limit`), `get <id>`, `create --file|--stdin`, `update <id> --file|--stdin`, `delete`, `activate`, `deactivate`, `tags <id>`, `transfer <id> --project` |
| `execution` | `list` (`--workflow`, `--status canceled|error|running|success|waiting`, `--limit`), `get <id> [--include-data]`, `retry`, `stop`, `delete` |
| `credential` | `list`, `get <id>` (metadata, never values), `schema <type>`, `create --type --name --data|--file|--stdin`, `delete`, `transfer --project` |
| `project` | `list`, `get`, `create --name`, `update`, `delete`, `members <id>`, `add-member --user --role`, `remove-member` |
| `tag` | `list`, `create --name`, `update`, `delete` |
| `variable` | `list`, `create --key --value`, `update`, `delete` |
| `data-table` | `list`, `get`, `create --name --columns '<json>'`, `delete`, `rows <id>`, `add-rows`, `update-rows`, `upsert-rows`, `delete-rows --ids` |
| `user` | `list`, `get` |
| `config` | `set-url`, `set-api-key`, `show` |
| `promotion-provider` | `list`, `get` (includes `publicKey`; list omits it), `create --stdin|--file`, `update` (sending `auth` replaces the credentials of every environment on it), `delete` (fails while an environment uses it), `list-repositories <id> [--search] [--limit]` and `list-branches <id> <fullPath or id> [--search] [--limit]` (GitLab providers only) |
| `promotion-environment` | `list [--scope instance|projects] [--direction apply|promote] [--provider]`, `get`, `create --file|--stdin` (one direction), `update` (name, provider, remote, settings; settings replace the whole object), `delete`, `connect <id>`, `disconnect <id>`, `list-changes <projectId> promote|apply [--search] [--sort name|updatedAt|status] [--order]`, `promote <id> [-m <msg>] [--force]`, `promote-selection`, `apply <id> [--expectedEnvironmentId --expectedBranch --expectedCommitSha]`, `apply-continue`, `apply-selection`, `apply-selection-continue`, `list-projects <id>`, `list-missing-projects <applyId>`, `create-missing-projects <applyId> [-p <projectId>]... [--admin <projectId>=<userId>]...`, `add-project <id> <projectId>`, `remove-project` |
| `source-control` | `pull [--force]` |
| `package` | `export`, `import --file` (beta), `import-selection` (beta) |
| `skill` | `install [--global] [--target claude-code|cursor|windsurf]` |
| top level | `audit [--categories credentials,database,nodes,filesystem,instance]`, `login`, `logout` |

Subcommand help: `n8n-cli promotion-environment apply --help`.

## package export flags

| Flag | Values | Note |
|---|---|---|
| `--agentId` (repeat) / `-w, --workflowId` (repeat) / `--folderId` (repeat) / `-p, --projectId` (repeat) | | What to include |
| `-o, --output` | path | default `export.n8np` |
| `--includeVariableValues` | true/false | |
| `--includeTags` | true/false | |
| `--includeArchivedWorkflows` | true/false | |
| `--dependencyPolicy` (0.22: `--missingWorkflowDependencyPolicy`) | `fail`, `reference-only`, `include-in-package` | sub-workflows not selected |
| `--versionPolicy` (0.22: `--workflowVersionPolicy`) | `published-strict`, `prefer-published`, `ignore-unpublished`, `latest` | which version ships |
| `--credentialExportPolicy` | `expression-values-only` (instance default), `no-values` | literal values never travel |

## package import flags

| Flag | Values |
|---|---|
| `--file` (required), `-p, --projectId` (default: personal project), `--folderId` | |
| `--conflictPolicy` (0.24: `--workflowConflictPolicy`) | `new-version` (default), `fail`, `skip`. Covers Agents and their skills as well |
| `--publishingPolicy` (0.24: `--workflowPublishingPolicy`) | `preserve-published-state`, `match-source`, `publish-all`, `unpublish-all` |
| `--idPolicy` (0.24: `--workflowIdPolicy new|source`) | `source` only: new entities take the package ids, matched ones keep their target ids |
| `--missingNodeTypeMode` | `fail`, `import-anyway` |
| `--projectConflictPolicy` / `--folderConflictPolicy` | `merge`, `fail`, `overwrite` |
| `--overwriteDeletionPolicy` | `archive`, `hard-delete` |
| `--credentialMatchingMode` | `id-only`, `name-and-type`, `type-only` |
| `--credentialMissingMode` | `must-preexist`, `create-stub`, `create-with-values` |
| `--credentialConflictPolicy` | `keep-existing` (instance default), `overwrite` (name and expression values of a matched credential a project of the import owns; needs `credential:update`), `fail` |
| `--dataTableMatchingMode` | `by-id` |
| `--dataTableMissingMode` | `create`, `must-preexist`, `do-nothing` |
| `--dataTableSchemaConflictPolicy` | `keep-existing`, `fail`, `overwrite`, `overwrite-non-destructive` |
| `--variableMissingMode` | `do-nothing`, `must-preexist`, `create-stub`, `create-with-value` |
| `--variableConflictPolicy` | `keep-existing`, `overwrite`, `fail` |
| `--variableParentPolicy` | `project`, `global` |
| `--tagMissingMode` | `create`, `do-nothing` |
| `--tagConflictPolicy` | `skip`, `fail`, `rename` |
| `--bindings` | JSON keyed by entity type, e.g. `{"credentials":{"<sourceId>":"<targetId>"}}`, applied before matching |

## promotion-environment apply

`apply ID [--expectedEnvironmentId --expectedBranch --expectedCommitSha]`.
Resets the local checkout to the configured branch tip and imports,
overwriting the instance. Workflows and folders move within their project to
match the branch; one the branch and the instance hold in different projects
is refused before any write. Exit 3 `source-changed`, exit 4 `blocked`
(bindings, access, conflicts): nothing imported in either case; `--json` lists
the blockers under `preflight`. `apply-continue` takes the same three flags
(required there) after the blockers are fixed, plus
`--confirmDestructiveChanges` for data table column removals and deleting team
projects the package does not hold. Requires a connected apply environment
with instance scope.

## promotion-environment promote

`promote ID [-m <message>] [--force]`. Exports all team projects, commits, and
pushes to the configured branch (or a new branch when
`createBranchOnPromotion` is true). Without `-m` the message is generated.
Refuses a workflow on the branch that moved to a personal project, or to
another team project while the old one exists. Requires a connected promote
environment with instance scope. API scopes: `gitConnection:*`, plus
`variable:list` when workflows reference variables.

## skill install

Writes the package's own `n8n-cli` skill (frontmatter `allowed-tools:
Bash(n8n-cli:*) ...`) into `.claude/skills/` (default, project), `~/.claude/skills/`
(`--global`), or the Cursor / Windsurf equivalents. It teaches the command
surface; this harness's skills add the delivery discipline around it.
