# Access control: roles, API keys, SAML provisioning

Reference depth for the RBAC and SSO sections of `SKILL.md`.

## Two levels of role

Instance roles govern the whole instance. Project roles govern one project, and a
user can hold a different project role in each project.

**Instance roles: Owner, Admin, Member.**

| Capability | Owner | Admin | Member |
|---|---|---|---|
| Own account, own workflows | yes | yes | yes |
| Create and use tags | yes | yes | yes |
| Delete tags | yes | yes | no |
| View and share all workflows | yes | yes | no |
| View, edit, share all credentials | yes | yes | no |
| Set up source control | yes | yes | no |
| Create projects, view all projects | yes | yes | no |
| Add and remove users | yes | yes | no |
| Cloud dashboard | yes | no | no |

Admin is Pro and Enterprise on Cloud, Enterprise only on self-hosted. There is one
Owner. n8n's own recommendation is that the Owner keeps a second Member account for
daily work, so routine building does not happen with instance-wide visibility.

**Project roles: Admin, Editor, Viewer.**

| Capability | Admin | Editor | Viewer |
|---|---|---|---|
| View workflows, credentials, executions | yes | yes | yes |
| Create, update, delete workflows and credentials | yes | yes | no |
| Execute workflows manually | yes | yes | no |
| Rename or delete the project | yes | no | no |
| Invite and remove members, change their roles | yes | no | no |
| Use external secrets (where enabled instance-side) | yes | yes | no |
| Manage secret vaults | yes | no | no |

Viewer is read-only including execution: a Viewer cannot manually run anything.
That is usually the right role for a customer stakeholder who wants to watch.

**Custom roles** exist at both levels. Custom project roles give granular
permissions over workflows, credentials, and project resources. Custom instance
roles grant specific instance capabilities (users, tags, API keys, roles) without
full Admin. Only the instance Owner and Admins can create them.

## API keys

Created per user under **Settings > n8n API**, with a label and an expiration.
Expiration can be `Never`, which means the key outlives everything unless someone
revokes it. On Enterprise you also choose **scopes**.

Three things that matter in delivery:

1. **API key scopes are instance-level and are not project role scopes.** They are
   a separate list. Do not reason about one from the other.
2. **A key belongs to the user who created it.** If your engagement automation runs
   on a key minted under your account, offboarding you breaks it. Mint automation
   keys under an account that outlives the engagement and say whose it is in the
   handoff.
3. **Rotation is in-place.** Settings > n8n API, row menu, Rotate. The secret is
   re-issued; name, scopes, and expiration survive. So rotation does not require
   re-scoping, which makes a 90-day rotation policy cheap to agree to.

`[FIELD]` whether the customer's platform team will accept human-owned API keys at
all. Some require a service identity that n8n does not have. Record the answer and
the workaround per engagement.

## Protocols

**SAML and OIDC** are the SSO protocols. LDAP is a separate licensed feature, not
part of the SSO configuration. From 2.18.0 SSO can be configured by **environment
variable** rather than only in the UI, which is what an infrastructure-as-code
customer will ask for.

## Required SAML attributes

Name format URI Reference:

| Value | Attribute |
|---|---|
| Email | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` |
| First name | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/firstname` |
| Last name | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/lastname` |
| Email (alternate) | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn` |

## Role provisioning (1.122.2+)

Two claims carry authorization from the IdP:

- **`n8n_instance_role`**, a string: `global:member`, `global:admin`,
  `global:chatUser`. Defaults to `global:member` when absent.
- **`n8n_projects`**, an array of `<project-id>:<role>`, for example
  `bHsykgeFirmIhezz:viewer`.

Two ways to map:

1. **On the IdP.** Their IdP admin decides which role and projects each user or
   group gets. In Okta, configure `n8n_instance_role` and `n8n_projects` as custom
   attributes. In Azure AD, source `n8n_projects` from `user.assignedroles` so
   multiple assignments arrive as an array.
2. **Inside n8n** (2.19.0+). Define expressions over a `$claims` object. Use this
   when the IdP team will not add n8n-specific attributes, which is common.

## Three delivery consequences

1. **Provisioning mode strips access that the IdP does not assert.** Any access
   granted inside n8n and not reflected in the IdP response is removed on the
   user's next login. Export the CSV backups n8n prompts for before switching it on.
   This is also how you lose your own project access mid-engagement.
2. **`n8n_projects` uses project IDs, not names.** IDs differ per instance, so the
   IdP mapping is environment-specific and does not promote from dev to production.
   Budget a mapping change per environment and put the ID table in the handoff.
3. **Keep one break-glass account.** Settings > Users, row menu, **Allow Manual
   Login** exempts a user from SAML. Set it for one account before enabling SSO,
   record who holds it, and make sure it is not only you.

**SCIM is not documented.** Treat lifecycle as attribute-driven at login, not
push-provisioned: a user deactivated in the IdP stops being able to log in, but do
not promise the customer that n8n-side records are reconciled automatically. If
their identity team asks specifically for SCIM, route it rather than guessing.
