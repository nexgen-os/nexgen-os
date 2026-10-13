# 0005 — Questions to settle before 0.1

Settled on 12/10/2026:

- **Contributor terms: DCO.** A sign-off on each commit, no contributor
  agreement, and nothing that could relicense the core away from AGPL
  (relicensing is what split Odoo's community in 2015). See
  [CONTRIBUTING.md](../../CONTRIBUTING.md).
- **Home of the project: the `nexgen-os` GitHub organisation.** A neutral
  foundation or association later, once there is traction (Open Home
  Foundation and LF Energy are the models).
- **Product types: `device_directory`.** A catalogue row (a PV module model, a
  heat pump model) whose values every installed device inherits, as IFC types
  do.

Still open:

- **Licence of the specification and vocabularies.** CC BY 4.0 is proposed,
  because it allows translations and forks. buildingSMART's CC BY-ND is the
  example to avoid.
- **Revised forecasts.** Settled in [0011](0011-external-data.md): every
  issue of a forecast in `forecast_values`, read by issue time.
- **Scale of series.** Settled in [0007](0007-series-at-scale.md).
- **Where Ekwo OS runs.** Same database or its own, and what the bridge is:
  [0010](0010-ekwo-link.md), proposed.
