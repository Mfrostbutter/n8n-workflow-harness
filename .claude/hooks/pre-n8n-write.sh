#!/usr/bin/env bash
# PreToolUse on instance-mutating n8n-mcp tools. Reminds, never blocks.
# Re-fires on every call on purpose: a repeat call usually means the same
# decision is being reconsidered.
set -u
command -v node >/dev/null 2>&1 || exit 0

node -e '
let raw = "";
process.stdin.on("data", d => raw += d);
process.stdin.on("end", () => {
  let tool = "", input = {};
  try {
    const p = JSON.parse(raw);
    tool = p.tool_name || "";
    input = p.tool_input || {};
  } catch {}

  const target = process.env.N8N_API_URL || "UNSET";
  // Activation is a field on an update, not a tool of its own.
  const activating = JSON.stringify(input).includes("\"active\":true");
  let msg;

  if (/credential/i.test(tool)) {
    msg = "Credential write against " + target + ". Confirm the target " +
      "instance first: a credential written to the wrong instance is a leak, " +
      "and the server only fail-closes the ambiguous case (see " +
      "n8n-multi-instance). Secret values never go in workflow text fields.";
  } else if (/delete/i.test(tool)) {
    msg = "Delete against " + target + ". Archive, do not delete: export it " +
      "and commit first, then deactivate, then remove.";
  } else if (activating) {
    msg = "Activating on " + target + ". Before this: validate_workflow " +
      "passed, n8n_get_workflow was read back, and its connections object " +
      "was inspected. Activation caches the trigger registration, so a later " +
      "edit may not reach the running trigger (see n8n-gotchas).";
  } else {
    msg = "Writing to " + target + ". After this call: n8n_get_workflow and " +
      "read the connections object. validate_workflow does not catch dropped " +
      "wires, Merge input off-by-one, or unwired error outputs. A 200 is not " +
      "proof the change took effect: verify with a fresh execution.";
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg }
  }));
});
' 2>/dev/null || exit 0
