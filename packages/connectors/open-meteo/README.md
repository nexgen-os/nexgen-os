# `@nexgen-os/open-meteo` — weather forecast and ERA5 history

Hourly forecast of temperature and irradiance and history from the ERA5 archive (irradiance on a plane, horizontal components `ghi`, `dni`, `dhi`, temperature, wind speed), worldwide, as a `WeatherProvider` of `@nexgen-os/core`. Source `open_meteo`. MIT; the data is CC BY 4.0, and the free API is for non-commercial use, a paid plan otherwise.

```ts
import { openMeteo } from '@nexgen-os/open-meteo';

const weather = openMeteo();
```

What it returns lands through `storeSeries()` of `@nexgen-os/core`, each series with its source. Decision [0011](../../../docs/decisions/0011-external-data.md).
