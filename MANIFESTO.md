# Why we are building Nexgen OS

Every building, every street, every field with panels on it is described
many times over. The architect draws it, the engineer models it, the
installer surveys it, the drone captures it, the utility meters it, the city
registers it, the owner pays for all of it — and each of them keeps their own
copy, in their own tool, in a format the next one cannot read. A roof is
measured five times in its life and known by none of the people who need it
next.

We think the description of the world should be done once, kept by the
people it belongs to, and shared on their terms. **The model of a place
belongs to whoever is responsible for it** — the owner, the project holder,
the community that shares its energy — and not to the tool that happened to
draw it, nor to the company that happened to compute it. The rules that turn
it into a permit, an energy study, a sharing key or a renovation plan belong
to everyone who has to follow them.

Three things follow, and they are the pact of this project:

- **the data is yours**: it sits in a database you control, in tables you
  can read, and leaves only when you say so;
- **the words are plain**: the trades have excellent standards and
  impossible vocabularies, so we took the best of the standards and gave
  every table, column and function a name anyone can understand, in the
  English of the trade, with the standard term written next to it;
- **the rules are data**: what a country, a grid operator or a market
  decides is a pack of files anyone can read, propose and prove, never a
  line of code with a country in it.

Two things are changing at once. The tools that describe places have become
cheap and everywhere: a phone scans a room, a drone flies a roof in ten
minutes, open data gives a footprint and a height for nearly every building
on earth, and a meter reports every quarter-hour. And what we ask of places
is changing faster than our tools: produce energy, share it with the
neighbours, shift a load when the grid is tight, prove a carbon figure, pass
a renovation obligation, be understood by the people who live around them. A
model built for one country, one product and one trade does not survive that.

Nexgen OS is an open digital twin of energy places — organisations, projects, participants, their meters, devices and series — driven by AI agents that work as users of the model.

So Nexgen OS is five commitments.

## 1. One description of a place, for everyone who works on it.

Nexgen OS names the things the trades name — an organisation, a project, a
participant with its place, the meter that connects it, the devices behind
that meter, the series they produce — and keeps each one once, in a table
that says what it always has. What we know beyond that is **attached** to
it: attributes with the period they hold for, the identifiers other systems
know it by, its documents — and, through the modules, its ground and its
buildings, their floors and rooms, their roof faces, its PV arrays, its
actions.

That is the whole core, and it is deliberately small and concrete. An
architect, an energy engineer, a facility manager, a city planner and a
resident open the same building and attach what they know. Nobody re-measures
a roof that somebody has already measured; everybody can see who measured
it, when, and how.

## 2. Built on the standards that already exist.

We did not invent a new way to describe buildings. The core speaks the
languages the trades already use, and every vocabulary row says which term
it stands for:

- the spatial structure and the property sets of **IFC** (ISO 16739) and the
  buildingSMART Data Dictionary;
- the floors of detail and surface semantics of **CityGML** and CityJSON;
- the equipment and points of **Brick** and of **Project Haystack**;
- the datastreams and observations of **OGC SensorThings**;
- the quantities and units of **QUDT**;
- global identifiers — IFC GlobalId, OpenStreetMap, Overture GERS, GS1 —
  side by side with the national registers each country pack adds.

A model can be read in from these formats and written back out without
anyone guessing. When a standard is missing a piece, we add it as a
vocabulary row with a name of its own, never by bending a term that already
means something else.

## 3. Owned, operable by a machine, checkable by a human.

Every installation stands on its own, with us or without us: the data sits
in Postgres with PostGIS, under row level security, and the owner holds the
keys. The schema comes with a REST API, and the model is designed for
machines as much as for people: an agent built on the model you choose can
read the model, attach a value, import a survey, run a study, prepare a
permit file or answer a resident — as *you*, with your rights and your
limits. The agent is a user of the model, with the same rights and the same
limits as the human beside it, and it can be replaced by another one
tomorrow. This is the way most places will be described and studied from
now on, and the core is built so that it happens on your data, in your
database, under your rules ([AGENTS.md](AGENTS.md)).

**Nothing in the core calls a model.** A geometry, a value, a series, a
computation is deterministic: a module hands its results back as an **estimate** or a
**settlement**, with the inputs it read and its provenance, the program and
the version that computed it: a figure says where it comes from, on your
machine and on an auditor's, this year and in ten years when somebody asks
why. Intelligence goes where it belongs — reading a plan, recognising a roof
in a point cloud, proposing a layout, explaining a result — and the
arithmetic stays in code anybody can read.

## 4. Modules beside the core, countries as data.

Energy is the first thing we compute — production, consumption,
self-consumption, energy sharing, and next batteries, charging and
flexibility — and each is a **module**, like the description of buildings,
the grid side of a meter, the bills of a participant and the actions of a
project. Each module starts from an object of the core, lives in its own
Postgres schema, with its own migrations and its own tests,
reads the core, and writes back through one function. A module the core has
never heard of can be written by the people who need it, without asking us.

A country is **data**: a pack of files that says how its regions are named,
which identifiers it uses, which registers and grid operators exist and
which values a study starts from, each with its source — that a
professional can read, a contributor can propose and a test can prove. No country is the
default, and no feature is limited to one.

Formats live in independent libraries — IFC, CityJSON, GeoJSON, 3D Tiles,
point clouds, metering exchanges — organised by format and never by country,
so that a new one is a package and not a fork.

## 5. Plugged into what exists, open to everyone who knows.

We do not compete with the open projects that already do their job well: the
BIM authoring tools, the 3D viewers, the photogrammetry pipelines, the home
and building automation platforms, the energy management systems. Nexgen OS
is the shared description they can all read from and write to.

The core is free software under **AGPL-3.0**, so that what is built on it
stays open. The format libraries and the connectors are **MIT**, so they can
go anywhere, including into tools that will never use Nexgen OS. Services
around it — hosted platforms, licensed data, studies, agents operated for
you — pay for the work, and never gate it
([docs/services.md](docs/services.md)).

## Who builds it, who operates it, who it is for

Nexgen OS is the foundation and the reference language, taken from a
platform that runs energy communities and studies in the field. Commercial
platforms for project holders, installers and communities may be built on
it, each with its own name, terms and roadmap. The foundation itself
belongs to the organisation that carries it on GitHub, its decisions are
public, and no single company can take it closed.

It is also a research foundation. Describing places once, with their
provenance and their rules, is what a research project on energy
communities, on building renovation, on grid flexibility or on digital
twins spends its first months rebuilding. Nexgen OS is that base, open, so
that universities, research centres and companies can start from it, test a
method on real descriptions and publish a module.

Nexgen OS is built by the people who know places: **architects and BIM
modellers** who map their models, **engineers** who write a module,
**surveyors and drone operators** who bring captures, **public bodies** who
publish their rules as a pack, **developers** who write a format library, and
the owners and residents whose questions are the roadmap. The decisions are
written down, with their reasons, in this repository — including the ones we
get wrong and have to take back.

If you describe places for a living, and you are tired of describing the
same roof again: this is where that work stops being lost.
