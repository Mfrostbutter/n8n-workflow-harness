# @n8n/cli 0.22.0 reference

Captured 2026-10-19 from `npx @n8n/cli@0.22.0 --help` and per-command help.
Install: `npm i -g @n8n/cli` or `npx @n8n/cli <command>`. Binary: `n8n-cli`.
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
| `promotion-provider` | `list`, `get` (includes `publicKey`; list omits it), `create --stdin|--file`, `update`, `delete` (fails while a connection uses it) |
| `promotion-connection` | `list [--scope instance|projects] [--provider]`, `get`, `create --file|--stdin`, `update`, `delete`, `set-config <id> promote|apply --stdin`, `delete-config <id> <direction>`, `clone <id> <direction>`, `disconnect <id> <direction>`, `list-changes <projectId> promote|apply [--search] [--sort name|updatedAt|status] [--order]`, `promote <id> -m <msg> [--force]`, `promote-selection`, `apply <id> [--expectedConfigId --expectedBranch --expectedCommitSha]`, `apply-continue`, `apply-selection`, `apply-selection-continue`, `list-projects <id>`, `add-project <id> <projectId>`, `remove-project` |
| `source-control` | `pull [--force]` |
| `package` | `export`, `import --file` (beta), `import-selection` (beta) |
| `skill` | `install [--global] [--target claude-code|cursor|windsurf]` |
| top level | `audit [--categories credentials,database,nodes,filesystem,instance]`, `login`, `logout` |

Subcommand help: `n8n-cli promotion-connection:apply --help` (colon form) or
`n8n-cli help promotion-connection apply`. The space-separated form with
`--help` fails on this version.

## package export flags

| Flag | Values | Note |
|---|---|---|
| `-w, --workflowId` (repeat) / `--folderId` (repeat) / `-p, --projectId` (repeat) | | What to include |
| `-o, --output` | path | default `export.n8np` |
| `--includeVariableValues` | true/false | |
| `--includeTags` | true/false | |
| `--includeArchivedWorkflows` | true/false | |
| `--missingWorkflowDependencyPolicy` | `fail`, `reference-only`, `include-in-package` | sub-workflows not selected |
| `--workflowVersionPolicy` | `published-strict`, `prefer-published`, `ignore-unpublished`, `latest` | which version ships |
| `--credentialExportPolicy` | `expression-values-only` (instance default), `no-values` | literal values never travel |

## package import flags

| Flag | Values |
|---|---|
| `--file` (required), `-p, --projectId` (default: personal project), `--folderId` | |
| `--workflowConflictPolicy` | `new-version`, `fail`, `skip` |
| `--workflowPublishingPolicy` | `preserve-published-state`, `match-source`, `publish-all`, `unpublish-all` |
| `--workflowIdPolicy` | `new`, `source` |
| `--missingNodeTypeMode` | `fail`, `import-anyway` |
| `--projectConflictPolicy` / `--folderConflictPolicy` | `merge`, `fail`, `overwrite` |
| `--overwriteDeletionPolicy` | `archive`, `hard-delete` |
| `--credentialMatchingMode` | `id-only`, `name-and-type`, `type-only` |
| `--credentialMissingMode` | `must-preexist`, `create-stub` |
| `--dataTableMatchingMode` | `by-id` |
| `--dataTableMissingMode` | `create`, `must-preexist`, `do-nothing` |
| `--dataTableSchemaConflictPolicy` | `keep-existing`, `fail` |
| `--variableMissingMode` | `do-nothing`, `must-preexist`, `create-stub`, `create-with-value` |
| `--variableConflictPolicy` | `keep-existing`, `overwrite`, `fail` |
| `--variableParentPolicy` | `project`, `global` |
| `--tagMissingMode` | `create`, `do-nothing` |
| `--tagConflictPolicy` | `skip`, `fail`, `rename` |
| `--bindings` | JSON keyed by entity type, e.g. `{"credentials":{"<sourceId>":"<targetId>"}}`, applied before matching |

## promotion-connection apply

`apply ID [--expectedConfigId --expectedBranch --expectedCommitSha]`. Resets
the local checkout to the configured branch tip and imports, overwriting the
instance. Exit 3 `source-changed`, exit 4 `blocked` (bindings, access,
conflicts): nothing imported in either case; `--json` lists the blockers under
`preflight`. `apply-continue` takes the same three flags after the blockers
are fixed. Requires the apply direction cloned.

## promotion-connection promote

`promote ID -m <message> [--force]`. Exports all team projects, commits, and
pushes to the configured branch (or a new branch when
`createBranchOnPromotion` is true). Requires the promote direction cloned.
API scopes: `gitConnection:*`, plus `variable:list` when workflows reference
variables.

## skill install

Writes the package's own `n8n-cli` skill (frontmatter `allowed-tools:
Bash(n8n-cli:*) ...`) into `.claude/skills/` (default, project), `~/.claude/skills/`
(`--global`), or the Cursor / Windsurf equivalents. It teaches the command
surface; this harness's skills add the delivery discipline around it.
