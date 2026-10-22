# 0052 — The end customer is a participant, with one account

> Status: accepted

## Context

A supplier, a community or a landlord wants the people it serves to see
their own: their meter, their readings, their bills, their share of a
community, the recommendations made to them — and to answer for the few
things that are theirs, how to reach them, what they consent to, how they
want to be notified. The participant already carries the meter and
everything under it. A second table of "participant members" would have
been a second place where an access is decided.

## Decision

**One account, on the participant.** `participants.user_id` (nullable) is
the account of the end customer a participant is. A person may hold the
account of several participants, of several organisations; a participant
has one account. The preset `participant` (decision
[0051](0051-roles-resolve-into-capabilities.md)) is resolved from it: it
holds `data.read` on that participant, on the participants it groups
(`parent_id`, a business with several sites) and on everything under them,
and the `account.*` capabilities:

- `account.contact` and `account.notifications` write the attributes of the
  participant whose type names them (`attribute_types.written_with`:
  `contact_email`, `contact_phone`, `notification_channels`);
- `account.consent` writes the consents of the participant;
- `account.decide` validates or dismisses a recommendation
  (`actions.decide()`).

It reads nothing of the other participants of the project, nothing of the
project or of the organisation. A community settlement belongs to the
project and names every participant; the account reads its own share
through `community.settlement_share()`.

**The account is opened by an invitation**, `invite_participant()`, taken by
`accept_invitation()` or `accept_invitations()` like every other; a
participant that already has an account refuses a second one
(`participant_has_account`).

## Consequences

- A supplier portal is an application built on these gestures; its screens,
  its brand and its per-supplier switches are not in this repository.
- The source `customer_declaration` signs what the customer declares.
- Two people sharing one contract share one account, or the organisation
  describes two participants.
