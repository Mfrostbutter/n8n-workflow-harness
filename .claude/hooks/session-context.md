## n8n workflow harness: active session contract

Target instance for managed (`n8n`) MCP calls: **{{TARGET}}**

Twenty n8n skills are installed in this project. `using-n8n-mcp-skills` is the
router: invoke it first on any n8n task, then the specialist it points at.
Load the skill BEFORE the action, not after it fails.

Rules that hold for this whole session:

1. `get_node` before setting node parameters. Never configure from memory.
2. `validate_workflow`, then `n8n_get_workflow` and read `connections`.
   Validation passing does not mean the workflow is wired correctly.
3. A 200 response is not proof. Verify with a fresh execution.
4. Secrets go through the n8n credential system. Never a text field, never a
   Set node, never this repo.
5. Dev first. `./scripts/export-all.sh` and commit before changing anything;
   `./scripts/drift-check.sh` before trusting `workflows/`.

Check templates (`search_templates`) before building a workflow from scratch.
