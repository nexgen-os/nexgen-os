# `@nexgen-os/pvgis` — PVGIS hourly energy and irradiance

Hourly energy, in-plane irradiance and temperature of a PV system over whole years (seriescalc), and its multi-year yield (PVcalc), from [PVGIS](https://joint-research-centre.ec.europa.eu/pvgis-online-tool_en) of the European Commission. Source `pvgis`. MIT; free, no key, no restriction on use. The azimuth from true north is turned into PVGIS's aspect from south; hours are dated at their start in UTC.

```ts
import { pvgis } from '@nexgen-os/pvgis';

const provider = pvgis();
```

Decision [0011](../../../docs/decisions/0011-external-data.md).
