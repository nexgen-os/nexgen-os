# Why we are building Nexgen OS

Every building, every street, every field with panels on it is described
many times over. The architect draws it, the engineer models it, the
installer surveys it, the drone captures it, the utility meters it, the city
registers it, the owner pays for all of it — and each of them keeps their own
copy, in their own tool, in a format the next one cannot read. A roof is
measured five times in its life and known by none of the people who need it
next. A meter reports every quarter-hour, and its curve sits in a portal
nobody else can reach.

Two things are changing at once. The tools that describe energy assets have
become cheap and everywhere: a phone scans a room, a drone flies a roof in
ten minutes, open data gives a footprint and a height for nearly every
building on earth, and a meter reports every quarter-hour. And what we ask
of those assets is changing faster than our tools: produce energy, store it,
share it with the neighbours, charge a fleet, shift a load when the grid is
tight, prove a carbon figure, pass a renovation obligation, be understood by
the people who pay for them. A model built for one country, one product and
one trade does not survive that.

Nexgen OS is a world model for energy assets — organisations, projects,
participants, their meters, devices and series — and the open source
operating system built on it, driven by AI agents that work as users of the
model ([0039](docs/decisions/0039-an-agent-is-a-user-of-the-model.md)).
*OS* reads both ways, on purpose: it is **open source**, and it is an
**operating system** for energy — one model that a solar study, a supplier's
customer app, a building's monitoring, an energy community's settlement and
an AI agent all run on.

It serves every actor of the energy world, and well beyond: whoever
monitors a site, supplies energy, develops a renewable project, manages a
building, shares energy in a community, operates a grid, finances a project
or studies any of them.

Three promises carry it:

- **the data is yours**: it sits in a database you control, in tables you
  can read, under your rules, and leaves only when you say so;
- **the rules are data**: what a country, a grid operator or a market
  decides is a pack of files anyone can read, propose and prove, never a
  line of code with a country in it;
- **every figure says where it comes from**: a yield, a sizing, a sharing
  or an indicator is computed by deterministic code and keeps the inputs,
  the program and the version it was computed with.

## 1. One model of an energy asset, for everyone who works on it.

Nexgen OS holds what the energy world already works with — the
organisation, the project it runs, the participants taking part in it, the
meter that connects each of them to the grid, the devices behind that
meter, the series they produce — and keeps each one once. What anyone knows
beyond that is **attached** to it: values with the period they hold for and
their source, the identifiers other systems know it by, its documents —
and, through the modules, its ground and its buildings, their floors and
rooms, their roof faces, its PV arrays, its batteries, its chargers, its
actions.

A designer, an energy engineer, a supplier, a facility manager, a city
planner and a resident open the same asset and attach what they know.
Nobody re-measures a roof that somebody has already measured; everybody can
see who measured it, when, and how.

## 2. Built on the standards that already exist.

The core speaks the languages the trades already use, and every vocabulary
row says which term it stands for:

- the spatial structure and the property sets of **IFC** (ISO 16739) and the
  buildingSMART Data Dictionary;
- the levels of detail and surface semantics of **CityGML** and CityJSON;
- the equipment and points of **Brick** and of **Project Haystack**;
- the datastreams and observations of **OGC SensorThings**;
- the quantities and units of **QUDT**;
- global identifiers — IFC GlobalId, OpenStreetMap, Overture GERS, GS1 —
  side by side with the national registers each country pack adds.

A model can be read in from these formats and written back out without
anyone guessing: IFC, CityJSON, GeoJSON, Home Assistant, OCPP, PVsyst PAN
and OND files, EPW and TMY3 weather, meter data files and energy bills each
have their open library.

## 3. Owned, operable by a machine, checkable by a human.

Every installation stands on its own, with us or without us: the data sits
in Postgres with PostGIS, under row level security, and the owner holds the
keys. The schema comes with a REST API, an MCP server and a Python client,
and the model is designed for machines as much as for people: an agent
built on the model you choose can read the model, attach a value, import a
meter curve, size a PV system or a battery, settle a sharing or propose an
action — as *you*, with your rights and your limits. The agent is a user of
the model, with the same rights and the same limits as the human beside
it, and it can be replaced by another one tomorrow
([AGENTS.md](AGENTS.md)).

**Nothing in the core calls a model.** A geometry, a value, a series, a
computation is deterministic: a module hands its results back as an
**estimate** or a **settlement**, with the inputs it read and its
provenance, the program and the version that computed it. A figure says
where it comes from, on your machine and on an auditor's, this year and in
ten years when somebody asks why. Intelligence goes where it belongs —
reading a plan, recognising a device in a load curve, proposing a layout,
explaining a result — and the arithmetic stays in code anybody can read.

## 4. What the foundation powers today.

Each trade is a **module** beside the core, in its own Postgres schema,
with its own migrations and its own tests. Today:

- **Solar** ([`solar`](modules/solar/README.md)): PV systems, arrays and
  their products, a yield through PVGIS, PVWatts or pvlib, P50 and the
  exceedance levels asked for, IEC 61724-1 indicators, an ordered loss
  chain and a far horizon; the sizing of a system on a measured curve,
  against a self-consumption rate, a self-sufficiency, a net present value
  or a payback.
- **Batteries** ([`battery`](modules/battery/README.md)): products and their
  physics, a dispatch on the interval series of a place or of a whole
  community, and the sizing of a battery with its cost, lifetime and
  operating cost.
- **Charging** ([`charging`](modules/charging/README.md)): chargers, their
  EVSEs and connectors, sessions, charging profiles sent as commands, and
  the sizing of charge points from the vehicles of a typical day and the
  power of the connection.
- **Energy sharing** ([`community`](modules/README.md)): the allocation key
  of a community, the consents of its participants, the perimeter of the
  operation checked against the rule of its country, and the shares an
  engine computes, checked against physics and recorded as settlements.
- **Consumption** ([`consumption`](modules/consumption/README.md)): the
  measured curve first, otherwise a curve estimated from a bill or a yearly
  figure and a load profile; devices recognised in a load curve by a
  disaggregation source, confirmed or dismissed by the customer.
- **Weather** ([`weather`](modules/weather/README.md)): weather points and
  sources, and the source each participant reads, resolved from its
  attribute, its organisation, its country and the coverage.
- **Grid and markets** ([`grid`](modules/grid/README.md)): the operator of
  each meter, its voltage level and substation, the mandates to read it at
  the operator's hub, its bidding zone and settlement period, and the
  support schemes of a country with the contract of each producing device.
- **Indicators** ([`kpis`](modules/kpis/README.md)): formulas as data —
  self-consumption and self-sufficiency, shared rates, peak offtake,
  specific yield and performance ratio, CO₂ avoided, Scope 2 location- and
  market-based, savings and injection value — computed hour by hour and
  written back as series, with their targets and export templates.
- **Actions** ([`actions`](modules/actions/README.md)): the steps of a
  project planned from templates per country, recommendations resting on an
  estimate, and commands sent to a device in real time, in one lifecycle.
- **Buildings** ([`building`](modules/building/README.md)): the ground,
  buildings, floors, rooms, zones and units, roof faces, facades and ground
  areas with their orientation, read from IFC, CityJSON and Home Assistant.
- **Billing** ([`billing`](modules/billing/README.md)): the bridge to an
  invoicing core, so that each participant is the one billed and the core
  holds no personal data.

Around them: **connectors** for meter data under mandate, weather
(Open-Meteo, PVGIS), geocoding (open registers and commercial services
alike) and programs in any language, pvlib first; **country packs** for
France, Belgium and Spain, each with worked cases a test proves; the
**`nexgen-os` installer**, which installs, upgrades, checks and tries the
foundation in memory; the **MCP server**, over stdio and HTTP; the
**Python client**; and seven example datasets, from a house to a district.

**Next**, on the [road to 1.0](docs/road-to-1.0.md): heating, thermal,
monitoring, sensors and wind modules; bidirectional charging, roaming and
the flexibility signals of a grid operator; battery ageing; guarantees of
origin and hourly matching; series at scale; georeferenced 3D models of
buildings; publications of open data; an activity log.

A module the core has never heard of can be written by the people who need
it, without asking us. A country is **data**: a pack that says how its
regions are named, which identifiers it uses, which registers and grid
operators exist and which values a study starts from, each with its
source. No country is the default, and no feature is limited to one.

## 5. Who it is for.

**Developers** start from a model that is already right about energy: six
objects, named refusals, a REST API, an MCP server, a TypeScript and a
Python client, MIT format libraries and connectors that can live inside any
product. One command tries it in memory; one installs it on a database of
their own.

**Utilities and energy suppliers** build the customer experience their
market now expects on a foundation they own — see
[For utilities](#for-utilities) below.

**Monitoring and energy management providers** get meters, devices and
series under one model, measured and estimated values told apart,
indicators computed hour by hour as data, and commands sent to a device
through the same lifecycle as a recommendation.

**Renewable project developers** compute, size and document a PV project,
a battery or a set of charge points with figures a lender, a reviewer or a
client can check, from the roof to the energy shared in a community.

**Building and facility managers** describe a building once — its floors,
rooms, roof faces and equipment, from IFC, CityJSON or Home Assistant — and
follow what it consumes and produces, meter by meter and device by device.

**Energy communities** hold their participants, their consents, their
allocation key and their settlements in a database of their own, checked
against the rule of their country, with the key a general assembly voted.

**Public bodies and research** publish their rules as a pack, and start a
project on energy communities, renovation, flexibility or digital twins
from a model that already holds the descriptions, their provenance and
their rules. Universities, research centres and companies test a method on
real descriptions and publish a module.

## For utilities

A supplier's customers now have heat pumps, electric vehicles, solar panels
and batteries, and expect to see what each one costs. Nexgen OS is the
foundation a supplier builds that relationship on:

- **a customer app under its own brand**: each customer is a participant
  with an account of their own, who reads their meters, devices and series
  and nothing of their neighbours, gives and withdraws consents and
  validates the recommendations made to them
  ([docs/access.md](docs/access.md));
- **energy insights on meter data**: the measured curve read under mandate,
  devices recognised in it, consumption estimated from a bill when no curve
  exists yet, and indicators — self-consumption, peak offtake, savings,
  CO₂ — computed hour by hour;
- **a meter portal**: every connection point under the identifier its
  operator gives it, checked against its scheme, with the operator, the
  voltage level and the market it belongs to;
- **sharing, solar, batteries and charging** for the customers who produce,
  store or charge, sized and settled by the modules above;
- **the customer base and its data owned by the supplier**, in its own
  database, under its own rules, exportable at any time;
- **an engine that stays open**: the core and the modules are AGPL, the
  connectors and format libraries MIT, so that what a supplier builds on
  never closes on it.

## Plugged into what exists, open to everyone who knows.

We do not compete with the open projects that already do their job well: the
BIM authoring tools, the 3D viewers, the photogrammetry pipelines, the home
and building automation platforms, the energy management systems. Nexgen OS
is the shared model they can all read from and write to.

The core is free software under **AGPL-3.0**, so that what is built on it
stays open. The format libraries and the connectors are **MIT**, so they can
go anywhere, including into tools that will never use Nexgen OS. Services
around it — hosted platforms, licensed data, studies, agents operated for
you — pay for the work, and never gate it
([docs/services.md](docs/services.md)).

## Who builds it

Nexgen OS is the foundation and the reference language, taken from a
platform that runs energy communities, supplier apps and studies in the
field. Commercial platforms may be built on it, each with its own name,
terms and roadmap. The foundation itself belongs to the organisation that
carries it on GitHub, its decisions are public, and no single company can
take it closed.

It is built by the people who know energy assets: **architects and BIM
modellers** who map their models, **engineers** who write a module,
**surveyors and drone operators** who bring captures, **suppliers and grid
operators** who bring their meters and their markets, **public bodies** who
publish their rules as a pack, **developers** who write a format library,
and the owners and residents whose questions are the roadmap. The decisions
are written down, with their reasons, in this repository — including the
ones we get wrong and have to take back.

If you work on energy assets for a living, and you are tired of describing
the same roof, the same meter and the same rule again: this is where that
work stops being lost.
