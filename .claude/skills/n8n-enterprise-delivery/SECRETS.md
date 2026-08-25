# External secrets: providers, syntax, rotation

Reference depth for the external secrets section of `SKILL.md`.

## Providers

Six providers: **1Password** (via Connect Server), **AWS Secrets Manager**,
**Azure Key Vault**, **GCP Secrets Manager**, **HashiCorp Vault**, **Infisical**.
HashiCorp *Vault Secrets* (the HCP product) is not supported; self-managed Vault
is. Check which one the customer actually runs before agreeing to it.

## Reference syntax

One form for every provider. Set the credential field to an Expression, then:

```
{{ $secrets.<vault-name>.<secret-name> }}
```

`<vault-name>` is the name you gave the store when you connected it, not the
provider name. For 1Password items with multiple fields, address the field:

```
{{ $secrets.<vault-name>.<item-title>.<field-label> }}
```

From 2.10.0 you can connect **multiple vaults per provider**, which is what makes
one instance able to serve two teams with separate Vault mounts.

## Three limits that change the design

1. **Resolves in credential fields only.** Not in node parameters, not in a Set
   node, not in a hand-typed HTTP Request header. If a workflow needs a secret
   anywhere other than inside a credential, external secrets will not solve it, and
   the fix is to move the call behind a credential-bearing node.
2. **Plaintext values only, no JSON objects.** Azure Key Vault is single-line only.
   A GCP service-account JSON key does not fit this model as one secret. Split it
   into fields or keep that one credential local.
3. **Vault management is role-gated.** Instance Owners and Admins manage global
   vaults. From 2.13.0, project Admins can manage project-scoped vaults and project
   Editors and Admins can use them where the instance enables it.

## Refresh and rotation

`N8N_EXTERNAL_SECRETS_UPDATE_INTERVAL`, seconds, default `300`. n8n polls for
changed secret values on that interval.

Rotation end to end, which is the actual pitch: rotate in the vault, n8n picks up
the new value within the update interval, and there is no credential edit, no
redeploy, and no n8n-side change at all. The customer's existing rotation process
keeps working and n8n is not in it.

The cost of that interval is a window, up to 5 minutes by default, where n8n still
holds the old value. For a rotation that invalidates the old secret immediately,
that window is failing executions. Either shorten the interval or sequence the
rotation to overlap.

`[FIELD]` **the unreachable-vault failure mode is not documented.** Before you put
this in front of a security team, test it on dev: block vault egress, then run a
workflow, and find out whether n8n serves the cached value, fails the node, or
fails at credential resolution, and what happens after the refresh interval
elapses. Write the observed behavior into the engagement runbook. Do not assert a
behavior here that you have not watched.
