# Examples

## `hello-set.json`

The smallest workflow that proves the loop: a Manual Trigger into a Set node
that emits one static field. No network, no credentials, nothing to clean up.

Validated two ways when it was written:

```bash
./scripts/validate.sh examples/hello-set.json    # offline structural check
```

and through `validate_workflow` on the docs MCP server, which returned
`valid: true` with zero errors and zero warnings.

Use it to confirm a new clone works end to end: import it, run it, read the
execution back, delete it. If that round trip works, the harness is wired
correctly.

Note the `typeVersion` on the Set node is **3.5**, which is what `get_node`
reported. The plausible guess was 3.4. That is the whole argument for
configuring from the live schema rather than from memory: 3.4 would have
validated and behaved differently. Re-check it against `get_node` on your own
n8n version before copying this into anything real.
