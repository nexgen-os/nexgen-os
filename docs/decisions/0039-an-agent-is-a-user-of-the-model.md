# 0039 — An agent is a user of the model

> Status: accepted

## Context

Describing a place, importing its files, computing a yield and reading it
back is work an AI agent can do for a person, and agents are a first
audience of the project. The easy way to let them in is a role of their
own, a service key with wide rights, or a function that writes whatever the
agent computed. Each of those turns the agent into a second, invisible
operator of the database: what it may do is not what the person may
do, and a figure it wrote cannot be told from a figure a calculation produced.

## Decision

**An agent acts as the person who asked it, with that person's rights.** It
signs in as the person, or uses a key the person issued and that writes as
that person; row level security decides what it sees and changes, by
organisation. There is no agent role and no back door.

**An agent uses the same gestures as everyone.** It reads through the read
functions (`attributes_of()`, `resample()`, `participant_of()`, `country_of()`),
attaches with a source, imports through the format libraries and the
connectors, and computes by starting a calculation of a module. A tool an agent is
given (a command line, an MCP server) calls those gestures and computes
nothing itself.

**An agent never writes a figure.** A yield, a loss or a settlement is a calculation,
reproducible by anyone ([0004](0004-a-figure-names-its-inputs-and-never-changes.md)); a value it
attaches carries the source it came from, never a number it made up.

**What the database refuses, the agent reports.** A named refusal is passed
on with its name ([0038](0038-everything-raises-by-name.md)), not worked
around.

**Nothing of the model depends on the agent.** Nothing in the core calls a
model; an agent can be replaced by another, or by a person, and every row
reads the same.

## What it forbids

- A database role, a key or a policy for agents as such.
- A function that writes a computed figure outside a calculation.
- Sending the data anywhere the person did not configure, or making any of
  it public without the person asking for it.

## See also

- Inherits Ekwo OS 0053 (*The MCP server acts as the user*), 0055 (*The
  command line acts as a signed-in person*) and 0064 (*A key writes as the
  person who issued it*).
- [`AGENTS.md`](../../AGENTS.md) — what an agent does here, and never does.
- [0037](0037-the-schema-grants-its-own-rights.md) — the rights it holds.
