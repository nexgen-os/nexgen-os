# `@nexgen-os/project-sheet` — a project as one table

A project sheet is the plainest way to hand a project to Nexgen OS: its
participants, the meters they carry and the devices behind them, as one
table any spreadsheet saves as CSV. This package reads it into plain
shapes, names with its line every cell it cannot read, and writes projects
back as a sheet it reads the same. MIT; no dependency, no database, no
network.

Start from [`template.csv`](template.csv): the header, one column per field.

| Columns | What they say | Notes |
|---|---|---|
| `project`, `country`, `project_kind`, `project_start_date`, `project_identifiers` | the project | `project` on every row; the country is an ISO 3166-1 alpha-2 code, never assumed |
| `participant`, `category`, `time_zone`, `participant_identifiers` | a participant of the project | empty on a row that only describes the project |
| `address_line1`, `address_line2`, `postal_code`, `city`, `region`, `participant_country`, `latitude`, `longitude`, `location_precision` | where the participant is | latitude and longitude in WGS 84 degrees, both or neither |
| `meter_scheme`, `meter_identifier`, `meter_name`, `meter_resource`, `meter_direction`, `meter_valid_from` | one meter of the participant | scheme and identifier both or neither |
| `device_type`, `device_name`, `device_rated_power_kw`, `device_unit_count`, `device_installed_on`, `device_identifiers` | one device of the participant | type and name both or neither |

How it reads:

- Rows naming the same project are one project; rows naming the same
  participant in it are one participant, the same meter (scheme and
  identifier) one meter, the same device (name) one device. A later row
  fills what an earlier one left empty; a value that contradicts one
  already read is reported as `values_disagree` and the first is kept.
- The columns come in any order; a column the sheet does not know is
  reported (`column_unknown`, a warning) and left aside.
- The separator is the one the header uses: a comma, a semicolon or a tab,
  as spreadsheets save in different languages. With a semicolon or a tab a
  number may carry a decimal comma.
- Dates are ISO 8601 days, `YYYY-MM-DD`. Identifiers an object is known by
  elsewhere are `scheme=value`, several separated by `|`.
- Codes — a country, a category, a device type, a scheme — are passed on as
  written: the model that receives them knows its vocabulary and refuses
  what it does not.

What it reports, by name and line: `column_missing`, `column_unknown`,
`column_repeated`, `quote_unterminated`, `row_too_long`,
`project_required`, `participant_required`, `invalid_number`,
`invalid_date`, `invalid_identifier`, `coordinates_incomplete`,
`meter_incomplete`, `device_incomplete`, `values_disagree`. Every problem
but `column_unknown` is an error: the sheet does not say what its author
meant.

```ts
import { readProjectSheet, writeProjectSheet } from '@nexgen-os/project-sheet';
import { importProjectSheet } from '@nexgen-os/core';

const sheet = readProjectSheet(text);
for (const p of sheet.problems) console.warn(p.line, p.code, p.column ?? '', p.value ?? '');

// Into Nexgen OS: refused while the sheet has an error, then imported and
// imported again without a duplicate.
const result = await importProjectSheet(db, organisationId, text, { dryRun: true });

const csv = writeProjectSheet(sheet.projects, { delimiter: ';' });
```

What it never does: look up a code, geocode an address, correct a cell.
Into Nexgen OS, `importProjectSheet()` of `@nexgen-os/core` gives each
project of the sheet to `importProject()`, which writes it through the
gestures of the schema and finds what is already there
(`nexgen-os project import --file <sheet.csv>`).
