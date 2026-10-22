# Access — who reads and writes what

Everything in Nexgen OS is read and written under row level security, as
the person signed in (`auth.uid()`). There is no agent role and no back
door: an agent, a script and a portal act as a person
([0039](decisions/0039-an-agent-is-a-user-of-the-model.md)). This page says
how a person comes to reach an object, and what they may do with it.

## Capabilities, and the roles that are their presets

A **capability** is one thing a person may be allowed to do, a code of
`capabilities` ([0051](decisions/0051-roles-resolve-into-capabilities.md)).
Every policy and every gesture of the core and of the modules asks
`has_capability(object_kind, object_id, capability)` — or, for a row whose
organisation, project and participant are known,
`row_has_capability(organisation_id, project_id, participant_id,
capability)`. No policy compares a role; the hygiene script refuses one that
does.

| Capability | What it allows |
| --- | --- |
| `data.read` | read the descriptions: projects, participants, meters, devices, series, attachments, module rows |
| `data.write` | describe, attach, import and compute |
| `shares.manage` | share a project, invite an editor or a viewer, open the account of a participant |
| `members.manage` | give, change and remove roles, invite an owner, issue and withdraw keys |
| `organisation.write` | rename or delete the organisation |
| `account.contact` | write the contact details of a participant |
| `account.consent` | give and withdraw the consents of a participant |
| `account.notifications` | choose how a participant is notified |
| `account.decide` | validate or dismiss a recommendation made to a participant |

A **role** is a preset: `role_capabilities` says what each holds. A module
adds its own codes (with `area` set to its code) and its own rows.

| Preset | Holds |
| --- | --- |
| `owner` | every capability |
| `editor` | everything but `members.manage` and `organisation.write` |
| `viewer` | `data.read` |
| `participant` | `data.read` and the `account.*` capabilities |

`my_capabilities(object_kind, object_id)` lists what the person signed in
holds on an object, for an interface or an agent that has to know before
it tries.

## Three ways to reach an object

**A member of the organisation** (`organisation_members`, a role `owner`,
`editor` or `viewer`) holds the preset of that role on everything of the
organisation. `create_organisation()`, `add_member()`, `set_member_role()`,
`remove_member()`; an organisation never loses its last owner.

**A person a project is shared with** (`project_shares`, a role `editor` or
`viewer`) holds the preset of that role on the project and everything under
it — its participants, their meters, devices, series and attachments, the
module rows about them — and nothing of the organisation itself.

**The account of a participant** (`participants.user_id`) is the end
customer a participant is: a household with its contract, a business on its
group of sites ([0052](decisions/0052-the-end-customer-is-a-participant.md)).
It holds the preset `participant` on that participant, on the participants
it groups (`parent_id`), and on everything under them: meters, devices,
series, estimates, bills, actions. It reads nothing of the other
participants of the project, nothing of the project or of the organisation.
A person may hold the account of several participants, of several
organisations. What it writes is its own:

- its contact details and notification settings, as attributes of the
  participant whose type is written with `account.contact` or
  `account.notifications` (`contact_email`, `contact_phone`,
  `notification_channels`; `attribute_types.written_with`), with the source
  `customer_declaration`;
- its consents (`community.give_consent()`, `community.revoke_consent()`);
- its answer to a recommendation (`actions.decide(action_id, 'validated' |
  'dismissed')`), which confirms or retires a device a disaggregation
  source recognised (`consumption.recognise_device()`);
- and it reads its share of a community settlement, never its neighbours'
  (`community.settlement_share(settlement_id, participant_id)`).

## Invitations

An invitation offers one of the three by email, with the sha256 of the token
of its link, an expiry and a revocation, in the columns of Ekwo OS's
invitations:

- `invite_member(organisation_id, email, role)` — a member of the
  organisation; only whoever holds `members.manage` offers `owner`;
- `invite_member(organisation_id, email, role, project_id)` — a share of
  one project;
- `invite_participant(participant_id, email)` — the account of a
  participant.

The person it was sent to takes it when they sign in
(`accept_invitation(token)`, `accept_invitations()`); `revoke_invitation()`
withdraws it. A participant that already has an account refuses a second
one (`participant_has_account`).

## API keys

A key is a delegation from a person, for a machine or an agent
([0046](decisions/0046-a-key-acts-as-its-issuer-an-agent-reaches-the-database-as-the-person.md)).
`create_api_key(organisation_id, name, capabilities, expires_at)` is issued by
whoever holds `members.manage`, with a list of codes of `capabilities` the
issuer holds (`capability_not_held` otherwise); `use_api_key(secret)`
presents it at the top of a transaction. The key acts as its issuer, within
its organisation and the capabilities on its list only, and a key holding
only `.read` capabilities runs its transactions read only.

## A portal is an application

A supplier portal — the end customer's screens, its brand, the switches a
supplier turns on or off — is an application built on these gestures, not
part of this repository. It signs the customer in with the installation's
Supabase Auth, takes their invitation, and reads and writes through the
policies above: nothing it shows can be more than the account of the
participant reaches.
