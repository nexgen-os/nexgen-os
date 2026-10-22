# 0051 — Roles resolve into capabilities; a project is shared through `project_shares`

> Status: accepted

## Context

Every policy of the core read a role: `can_read_organisation()`,
`can_write_organisation()` and `is_organisation_owner()` compared
`organisation_members.role` with `owner`, `editor` and `viewer`, and
`can_read_row()` / `can_write_row()` added the role of a project shared with
a person. Three positions and nothing between them: a person who may share a
project and must not manage the members, or an end customer who reads one
participant and nothing else, had no row to sit on. Ekwo OS met the same
wall and answered it with capabilities; a person who administers both reads
one model if both answer the same way.

A project shared with a person needs a name too, and the platform the core
was taken from has one: `project_shares`.

## Decision

**A role is a preset; a capability is what a policy asks for.**
`capabilities` (code, area, description) and `role_capabilities` (role,
capability), in the shape and the words of Ekwo OS. Every policy and every
write gesture of the core and of the modules asks
`has_capability(object_kind, object_id, capability)`, or
`row_has_capability(organisation_id, project_id, participant_id,
capability)` for a row whose three are known. It resolves the organisation
membership, the project share and the account of a participant
([0052](0052-the-end-customer-is-a-participant.md)) into one answer.
`secure_table()` takes the expression of a row's participant and the
capability that writes it. The hygiene script refuses a policy that
compares a role.

The presets keep exactly what each role could do: `viewer` holds
`data.read`; `editor` adds `data.write` and `shares.manage`; `owner` adds
`members.manage` and `organisation.write`. A matrix test holds each preset
to it, gesture by gesture.

A project share is resolved with the same presets, on the project and what
is under it only; an organisation-level capability is never asked about a
project, so a share never reaches the organisation.

**An API key carries capabilities from the same table**, each held by its
issuer when issued; it reaches what its list names, on top of what its
issuer holds at the moment of the call. One holding only `.read`
capabilities runs read only.

**A project is shared through `project_shares`**, the platform's word, in
its table, trigger, policies, tests and documentation.

## Consequences

- A module adds its own codes and rows; nothing enumerates the areas.
- `organisation_role()` stays, for a page that shows which preset a person
  is on; no policy and no gesture reads it.
- Per-member adjustments (Ekwo OS's `capabilities_granted` and
  `capabilities_revoked`) are not taken over yet: no case needs them, and
  the column can be added without moving a policy.
