# What Nexgen OS is, and who it is for

Nexgen OS is open source data infrastructure: a database schema, rules
written as data, format libraries, connectors and modules. It is built for
the people who study, equip, operate and finance energy places — engineering
offices, surveyors, installers, energy suppliers, grid operators, energy
communities and the people who fund them — and with them. It is software:
it gives them shared data and tools, and the judgement stays theirs.

*Version 2.0 — 21 October 2026. This page applies to Nexgen OS, the software
of this repository.*

## 1. What the project is

Nexgen OS gives an organisation a place to hold the data of its energy
places — a PostgreSQL schema it installs on a database it controls —
together with:

- **a core** for organisations, projects, participants, their meters, their
  devices and the series those produce;
- **modules** that enrich an object of the core with one physics each: the
  grid side of a meter, the building of a participant, the energy shared in a
  community, the yield of a solar installation, the tasks of a project;
- **country packs**: a reading of a country's rules on grids, energy
  sharing, buildings and support, written as data with their sources;
- **format libraries and connectors** that read and write published formats
  and reach the services an organisation chooses;
- **tools** — a command line, a TypeScript client, a Python client — through
  which a person, a script or an AI agent works on that data.

The mission of the project is to provide that infrastructure, openly, in
every country, to the professions that make energy places work. The tools
are built to be used by those professionals, and to be read and checked by
them.

## 2. How the work is divided

The professions above carry responsibilities the law gives them: a study
signed by an engineer, a survey, the conformity of an installation before it
is energised, the supply of energy, the operation of a grid, a financing
decision. Nexgen OS supports that work and does not take it over: through
the software, the documentation, the country pages or any exchange on an
issue or a forum, the project and its contributors provide no engineering
study, survey, certification, conformity attestation, energy supply, grid
service, or financial, legal or investment advice.

No professional relationship, engagement or duty of care arises from using
the software, reading its documentation or contributing to it. If you need
someone to answer for a study, an installation or a decision, engage them —
the tools are made so they can work on the same data.

## 3. Your places, your projects, your decisions

You — the organisation, or the professional you engage — remain responsible
for:

- the accuracy of the places, meters, devices and series you describe;
- every request, declaration, contract and payment, with a grid operator,
  an administration or a counterpart, its content and its date;
- the choice of the rules, parameters and assumptions that apply to you;
- checking what the software computes before you rely on it.

Nexgen OS sends nothing to any operator or administration on its own
initiative.

## 4. What a figure here is

- **A yield, a loss, a saving, a payback is an estimate**: the result of a
  computation that names the weather, the period, the models, the losses and
  the prices it used. Change an input and the figure changes. A figure says
  where it comes from; it is not a guarantee of production.
- **A P50 or a P90 is a probability over years of weather**, from the data
  and the method the computation names. It is an input to a bankability
  study, which a qualified professional carries out.
- **A geometry, a footprint, a height, a roof face is as precise as its
  source says**: a cadastre, a city model, a survey, a geocoder — each
  carries its precision and its licence. A point placed by a geocoder is not
  a boundary.
- **A settlement computed here is a computation**; the invoice, the tax and
  the ledger entry are issued by the tool you use for that.

An AI agent connected to Nexgen OS acts with your rights and on your
instruction. What it reads, proposes or drafts is the output of a model you
chose, which the project neither supplies nor controls. Check it before you
rely on it.

## 5. Country packs, and what their status means

A country pack is a reading of a country's rules at the date of its version.
Rules change, and a pack can be wrong, incomplete, out of date or not
applicable to your situation. Every rule cites its legal source, so that
you, or the professional you work with, can check it. The text prevails.

- **community**: proposed by someone and checked by the toolchain; nobody
  has reviewed it.
- **maintained**: the maintainers keep it up to date when they can; no
  update is promised.
- **reviewed**: read by a named professional of the country, on the date
  shown.

A review is a good-faith reading given to the community for free. It is not
an engagement, an opinion or a guarantee, and neither the reviewer nor the
project assumes liability for what is decided on the strength of it.

## 6. Software you can change, data you keep

Nexgen OS is free software. You may modify the schema, the rules, the packs
and the tools, and install versions, forks or modules the project has never
seen. The project cannot know how the software is configured, extended or
used in an installation, and is not responsible for the result of a
modification, a configuration, a third-party module or a pack that did not
come from this repository.

The data is in a database you control. Nothing in this repository sends it
anywhere, and nothing calls a service you did not configure. Row level
security is part of the schema; keeping the keys safe is yours. An
installation that holds personal data — the participants of a community,
their meter readings — makes its operator the controller of that data, under
the data protection law of the country concerned.

## 7. Licences, no warranty, no liability

The core and the modules are licensed under the GNU Affero General Public
License, version 3 (AGPL-3.0): use them, change them, run them for others,
and publish what you change. As its sections 15 and 16 state, the program is
provided "as is", without warranty of any kind, express or implied,
including the implied warranties of merchantability and fitness for a
particular purpose; the entire risk as to its quality and performance is
with you; and in no event, unless required by applicable law or agreed to in
writing, will any copyright holder, or any other party who modifies or
conveys it, be liable to you for damages, including any general, special,
incidental or consequential damages. Section 17 asks a court to apply the
local law that most closely approximates an absolute waiver of liability.

The format libraries and the connectors are licensed under the MIT licence,
which provides them "as is", without warranty of any kind, and excludes any
liability of the authors or copyright holders for any claim, damages or
other liability arising from the software or its use. The data you read
through a connector keeps the licence of its source, which the `sources`
table names, with its attribution and the time you may keep it.

Where the law of your country does not allow a limitation or exclusion of
liability, that limitation or exclusion applies to the fullest extent that
law permits, and the rest of this page still applies. Nothing here limits
liability that cannot lawfully be limited, nor your statutory rights as a
consumer.

## 8. Working with the professionals of your country

Engineering, surveying, electrical installation, energy supply and grid
operation are regulated activities in many countries, and the titles that go
with them are protected. Before relying on the software for a study, a
request to a grid operator, an investment or a declaration, work with a
professional who is authorised in the country concerned.

**Nexgen OS works with these professions, for them.** The project builds
the infrastructure — the schema, the rules of a country written as data, the
tools — and the people qualified to judge, sign and answer for the work use
it. A country pack can be read by a named professional, and its status says
so (§5). The project does not appoint, endorse or vouch for anyone, and
engaging a professional is a contract between you and them.

## 9. Names and trademarks

Names and logos cited in this repository — among them AI models and their
publishers, PostgreSQL, GitHub, and the operators, administrations,
standards, datasets and file formats a pack or a connector refers to —
belong to their respective owners. Nexgen OS is not affiliated with,
endorsed by or certified by any of them. Compatibility is through open
protocols and published standards.

## 10. If something here is wrong

If a pack is wrong for your country, open an issue and cite the rule: that
is how a pack gets better. This page may be updated; the version and the
date at the top say which one you are reading, and the history of the
repository keeps every earlier one.
