"""The pvlib engine: one `pv_yield` request in, hourly series out.

Contract 1 (engines/README.md): the envelope arrives on stdin, the answer
leaves on stdout, stderr is a log. A refusal is `{"error": name, "detail":
text}` on stdout with exit code 1. Nothing here reads a database, calls the
network or writes a file.

Conventions, as in the core: every stamp is ISO 8601 with its offset and
dates the start of its interval; azimuth in degrees clockwise from true
north, tilt from horizontal; irradiance W/m2, temperature degC, wind m/s,
energy kWh per interval.
"""

import json
import math
import platform
import sys

from . import __version__

ENGINE = "pvlib"
CONTRACT = 1
KINDS = ["pv_yield"]

# The mountings of `solar.pv_arrays`, mapped to the temperature parameters
# pvlib publishes (pvlib.temperature.TEMPERATURE_MODEL_PARAMETERS). PVsyst's
# U-values per mounting are the ones docs/research/solar-tools.md section 1.2
# reads from PVsyst's help: free-standing 29, semi-integrated 20, insulated
# back 15, all with Uv 0; pvlib carries the same three. A roof-parallel
# array on a pitched roof is ventilated from below like PVsyst's
# semi-integrated case. Faiman has no published values per mounting: its U0
# and U1 come from the yield profile (pvlib's defaults 25 / 6.84 in the
# `pvwatts` profile, PVGIS's 26.9 / 6.2 in `pvgis_like`), as
# modules/solar/src/pvwatts.ts reads them.
MOUNTING_TEMPERATURE = {
    "sapm": {
        "open_rack": "open_rack_glass_polymer",
        "floating": "open_rack_glass_polymer",
        "roof_parallel": "close_mount_glass_glass",
        "semi_integrated": "close_mount_glass_glass",
        "insulated": "insulated_back_glass_polymer",
    },
    "pvsyst": {
        "open_rack": "freestanding",
        "floating": "freestanding",
        "roof_parallel": "semi_integrated",
        "semi_integrated": "semi_integrated",
        "insulated": "insulated",
    },
}
TEMPERATURE_KEYS = {"faiman": ("u0", "u1"), "pvsyst": ("u_c", "u_v"), "sapm": ("a", "b", "deltaT")}
MOUNTINGS = ("open_rack", "roof_parallel", "semi_integrated", "insulated", "floating")
DC_MODELS = {"pvwatts": "pvwatts", "cec": "cec", "pvsyst": "pvsyst", "sapm": "sapm"}
AC_MODELS = ("pvwatts", "sandia", "adr", "no_loss")
TRANSPOSITIONS = ("haydavies", "perez", "isotropic", "klucher", "reindl")
AOI_MODELS = ("physical", "ashrae", "martin_ruiz", "sapm", "no_loss")
SPECTRAL_MODELS = ("no_loss", "sapm", "first_solar")
IRRADIANCE = ("ghi", "dni", "dhi", "poa_irradiance")


class Refusal(Exception):
    """A refusal by name: `weather_incomplete`, `array_invalid`, `model_unknown`..."""

    def __init__(self, name, detail):
        super().__init__(f"{name}: {detail}")
        self.name = name
        self.detail = detail


def describe():
    import numpy
    import pandas
    import pvlib

    dependencies = {
        "nexgen_pvlib": __version__,
        "python": platform.python_version(),
        "pvlib": pvlib.__version__,
        "pandas": pandas.__version__,
        "numpy": numpy.__version__,
    }
    try:
        import scipy

        dependencies["scipy"] = scipy.__version__
    except ImportError:
        pass
    return {"dependencies": dependencies, "kinds": KINDS}


def version():
    import pvlib

    return f"pvlib {pvlib.__version__}"


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------


def _step_hours(series):
    """The step of an interval series, in hours, from its `step` or its stamps."""
    import pandas as pd

    step = series.get("step")
    if step:
        try:
            return pd.Timedelta(step.replace("hours", "h").replace("hour", "h").replace("minutes", "min").replace("minute", "min")).total_seconds() / 3600
        except ValueError:
            raise Refusal("weather_incomplete", f"step {step!r} of {series['quantity_code']} is not readable")
    stamps = sorted({v["at"] for v in series["values"]})
    if len(stamps) < 2:
        raise Refusal("weather_incomplete", f"{series['quantity_code']} has no step and fewer than two values")
    return (pd.Timestamp(stamps[1]) - pd.Timestamp(stamps[0])).total_seconds() / 3600


def _values(series):
    import pandas as pd

    values = series.get("values") or []
    index = pd.to_datetime([v["at"] for v in values], utc=True, format="ISO8601")
    data = [float("nan") if v.get("value") is None else float(v["value"]) for v in values]
    return pd.Series(data, index=index, dtype="float64").sort_index()


def _over_intervals(series, index, step_h):
    """A series on the intervals of `index`: an interval series as it is; an
    instant series as the mean of its readings at the two ends of each
    interval, or the one present (as modules/solar/src/pvwatts.ts aligns them)."""
    import pandas as pd

    values = _values(series)
    values = values[~values.index.duplicated(keep="last")]
    if series.get("value_kind") == "instant":
        start = values.reindex(index)
        end = values.reindex(index + pd.Timedelta(hours=step_h))
        end.index = index
        return pd.concat([start, end], axis=1).mean(axis=1, skipna=True)
    return values.reindex(index)


def read_weather(weather, arrays):
    """The weather of a request: one frame for the site (ghi, dni, dhi,
    temp_air, wind_speed) and, per array, its plane-of-array irradiance when
    given. Indexed by the start of each interval, UTC."""
    import pandas as pd

    if not isinstance(weather, list) or not weather:
        raise Refusal("weather_incomplete", "the request has no weather series")
    names = {a["name"] for a in arrays}
    site, per_array = {}, {}
    for s in weather:
        q = s.get("quantity_code")
        target = s.get("array")
        if target is not None and target not in names:
            raise Refusal("weather_incomplete", f"{q} is given for array {target!r}, which the request does not have")
        if target is None:
            site[q] = s
        else:
            per_array.setdefault(target, {})[q] = s

    if "temperature" not in site:
        raise Refusal("weather_incomplete", "no air temperature series (temperature)")
    if "wind_speed" not in site:
        raise Refusal("weather_incomplete", "no wind speed series (wind_speed)")
    poa_given = "poa_irradiance" in site or any("poa_irradiance" in v for v in per_array.values())
    if poa_given:
        missing = [a["name"] for a in arrays if "poa_irradiance" not in per_array.get(a["name"], {}) and "poa_irradiance" not in site]
        if missing:
            raise Refusal("weather_incomplete", f"poa_irradiance is given for some arrays but not for {', '.join(missing)}")
        reference = site.get("poa_irradiance") or per_array[arrays[0]["name"]]["poa_irradiance"]
    elif "ghi" in site or ("dni" in site and "dhi" in site):
        reference = site.get("ghi") or site["dni"]
    else:
        raise Refusal("weather_incomplete", "no irradiance: give ghi (with or without dni and dhi), or poa_irradiance")

    if reference.get("value_kind") != "interval":
        raise Refusal("weather_incomplete", f"{reference['quantity_code']} must be an interval series (a mean over each interval)")
    step_h = _step_hours(reference)
    index = _values(reference).index
    index = index[~index.duplicated()]
    if len(index) == 0:
        raise Refusal("weather_incomplete", f"{reference['quantity_code']} has no values")
    if len(index) > 1:
        gaps = (index[1:] - index[:-1]).total_seconds() / 3600
        if (abs(gaps - step_h) > 1e-9).any():
            raise Refusal("weather_incomplete", f"{reference['quantity_code']} is not regular at its step of {step_h} h; give every interval")

    frame = pd.DataFrame(index=index)
    for q, column in (("ghi", "ghi"), ("dni", "dni"), ("dhi", "dhi"), ("temperature", "temp_air"), ("wind_speed", "wind_speed")):
        if q in site:
            frame[column] = _over_intervals(site[q], index, step_h)
    for column, quantity in (("temp_air", "temperature"), ("wind_speed", "wind_speed")):
        missing = int(frame[column].isna().sum())
        if missing:
            raise Refusal("weather_incomplete", f"{quantity} is missing over {missing} of {len(index)} intervals")
    for column in ("ghi", "dni", "dhi"):
        if column in frame:
            missing = int(frame[column].isna().sum())
            if missing:
                raise Refusal("weather_incomplete", f"{column} is missing over {missing} of {len(index)} intervals")
            frame[column] = frame[column].clip(lower=0)

    poa = {}
    if poa_given:
        for a in arrays:
            s = per_array.get(a["name"], {}).get("poa_irradiance") or site["poa_irradiance"]
            values = _over_intervals(s, index, step_h)
            missing = int(values.isna().sum())
            if missing:
                raise Refusal("weather_incomplete", f"poa_irradiance of {a['name']} is missing over {missing} of {len(index)} intervals")
            poa[a["name"]] = values.clip(lower=0)
    return frame, poa, step_h


# ---------------------------------------------------------------------------
# The system
# ---------------------------------------------------------------------------


def _number(value, what):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise Refusal("array_invalid", f"{what} must be a number, got {value!r}")
    return float(value)


def remaining_after_losses(losses):
    """The fraction that remains after an ordered list of losses, each a
    fraction of what the previous ones left (a negative one is a gain)."""
    if losses is None:
        return 1.0, []
    if not isinstance(losses, list):
        raise Refusal("array_invalid", "losses must be an ordered list of {code, fraction}")
    remaining, applied = 1.0, []
    for loss in losses:
        code = loss.get("code")
        fraction = loss.get("fraction")
        if fraction is None:
            raise Refusal("loss_without_value", f"{code}: the loss has no value")
        fraction = _number(fraction, f"the loss {code}")
        if not -1 < fraction < 1:
            raise Refusal("array_invalid", f"the loss {code} is {fraction}; a fraction lies between -1 and 1")
        remaining *= 1 - fraction
        applied.append({"code": code, "fraction": fraction})
    return remaining, applied


def temperature_parameters(model, mounting, given):
    """The temperature parameters of an array: the request's when it gives
    them, else pvlib's published set for the array's mounting."""
    from pvlib.temperature import TEMPERATURE_MODEL_PARAMETERS

    if model not in TEMPERATURE_KEYS:
        raise Refusal("model_unknown", f"temperature model {model!r}; this engine has {', '.join(TEMPERATURE_KEYS)}")
    if given:
        missing = [k for k in TEMPERATURE_KEYS[model] if k not in given]
        if missing:
            raise Refusal("model_parameters_missing", f"temperature model {model} needs {', '.join(TEMPERATURE_KEYS[model])}")
        return {k: _number(v, f"temperature parameter {k}") for k, v in given.items()}, "request"
    table = MOUNTING_TEMPERATURE.get(model)
    if table is None:
        raise Refusal("model_parameters_missing", f"temperature model {model} has no published parameters per mounting; give models.temperature_parameters ({', '.join(TEMPERATURE_KEYS[model])})")
    key = table[mounting]
    return dict(TEMPERATURE_MODEL_PARAMETERS[model][key]), f"pvlib {model} {key}"


def build_arrays(request):
    from pvlib.pvsystem import Array, FixedMount

    arrays = request.get("arrays")
    if not isinstance(arrays, list) or not arrays:
        raise Refusal("array_invalid", "the request has no arrays")
    models = request.get("models") or {}
    temperature_model = models.get("temperature")
    if temperature_model is None:
        raise Refusal("model_unknown", "models.temperature is required (faiman, pvsyst or sapm)")
    dc_models, names, built, described = set(), set(), [], []
    for i, a in enumerate(arrays):
        name = a.get("name")
        if not isinstance(name, str) or not name.strip():
            raise Refusal("array_invalid", f"array {i} has no name")
        if name in names:
            raise Refusal("array_invalid", f"two arrays are named {name!r}")
        names.add(name)
        mounting = a.get("mounting")
        if mounting == "tracker":
            raise Refusal("array_invalid", f"{name}: trackers are not covered by this engine yet (pvlib SingleAxisTrackerMount would)")
        if mounting not in MOUNTINGS:
            raise Refusal("array_invalid", f"{name}: mounting {mounting!r}; one of {', '.join(MOUNTINGS)}")
        azimuth = _number(a.get("azimuth_deg"), f"{name}: azimuth_deg")
        tilt = _number(a.get("tilt_deg"), f"{name}: tilt_deg")
        if not (0 <= azimuth < 360 and 0 <= tilt <= 90):
            raise Refusal("array_invalid", f"{name}: azimuth {azimuth} (0 to 360, from north clockwise) or tilt {tilt} (0 to 90) out of range")
        module = a.get("module") or {}
        model = module.get("model")
        if model not in DC_MODELS:
            raise Refusal("model_unknown", f"{name}: module model {model!r}; one of {', '.join(DC_MODELS)}")
        parameters = module.get("parameters")
        if not isinstance(parameters, dict) or not parameters:
            raise Refusal("array_invalid", f"{name}: the module has no parameters")
        dc_models.add(model)
        modules_per_string = int(_number(a.get("modules_per_string", 1), f"{name}: modules_per_string"))
        strings = int(_number(a.get("strings", 1), f"{name}: strings"))
        if modules_per_string < 1 or strings < 1:
            raise Refusal("array_invalid", f"{name}: modules_per_string and strings are at least 1")
        albedo = a.get("albedo", request.get("albedo"))
        if albedo is not None:
            albedo = _number(albedo, f"{name}: albedo")
        tparams, tsource = temperature_parameters(temperature_model, mounting, models.get("temperature_parameters"))
        built.append(
            Array(
                mount=FixedMount(surface_tilt=tilt, surface_azimuth=azimuth),
                albedo=albedo,
                module_parameters=parameters,
                temperature_model_parameters=tparams,
                modules_per_string=modules_per_string,
                strings=strings,
                name=name,
            )
        )
        described.append(
            {
                "name": name,
                "azimuth_deg": azimuth,
                "tilt_deg": tilt,
                "mounting": mounting,
                "module_model": model,
                "modules_per_string": modules_per_string,
                "strings": strings,
                "albedo": built[-1].albedo,
                "temperature": {"model": temperature_model, "parameters": tparams, "from": tsource},
            }
        )
    if len(dc_models) > 1:
        raise Refusal("array_invalid", f"the arrays use several module models ({', '.join(sorted(dc_models))}); one request per module model")
    return built, described, DC_MODELS[dc_models.pop()], temperature_model


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------


def pv_yield(request):
    import pandas as pd
    import pvlib
    from pvlib.location import Location
    from pvlib.modelchain import ModelChain
    from pvlib.pvsystem import PVSystem

    site = request.get("site") or {}
    lat = site.get("lat")
    lon = site.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise Refusal("site_invalid", "site.lat and site.lon are required, in degrees")
    altitude = site.get("altitude_m")

    arrays, described, dc_model, temperature_model = build_arrays(request)
    request_arrays = request["arrays"]
    weather, poa, step_h = read_weather(request.get("weather"), request_arrays)

    models = request.get("models") or {}
    aoi = models.get("aoi", "no_loss")
    spectral = models.get("spectral", "no_loss")
    if aoi not in AOI_MODELS:
        raise Refusal("model_unknown", f"aoi model {aoi!r}; one of {', '.join(AOI_MODELS)}")
    if spectral not in SPECTRAL_MODELS:
        raise Refusal("model_unknown", f"spectral model {spectral!r}; one of {', '.join(SPECTRAL_MODELS)}")

    inverter = request.get("inverter") or {}
    ac_model = inverter.get("model")
    if ac_model not in AC_MODELS:
        raise Refusal("model_unknown", f"inverter model {ac_model!r}; one of {', '.join(AC_MODELS)}")
    inverter_parameters = inverter.get("parameters") or {}
    if ac_model != "no_loss" and not inverter_parameters:
        raise Refusal("array_invalid", f"the {ac_model} inverter has no parameters")

    remaining, losses = remaining_after_losses(request.get("losses"))

    def ordered_losses(mc):
        # The profile's losses, each on what the previous ones left, applied
        # to the DC power (and current) before the inverter.
        def scale(dc):
            if isinstance(dc, pd.DataFrame):
                dc = dc.copy()
                for column in ("p_mp", "i_mp"):
                    if column in dc:
                        dc[column] = dc[column] * remaining
                return dc
            return dc * remaining

        mc.results.losses = remaining
        mc.results.dc = tuple(scale(dc) for dc in mc.results.dc) if isinstance(mc.results.dc, tuple) else scale(mc.results.dc)
        return mc

    def no_inverter(mc):
        # AC equals DC: the `pvwatts` profile of modules/solar/src/pvwatts.ts
        # models no inverter.
        dc = mc.results.dc if isinstance(mc.results.dc, tuple) else (mc.results.dc,)
        power = [d["p_mp"] if isinstance(d, pd.DataFrame) else d for d in dc]
        mc.results.ac = sum(power[1:], power[0])
        return mc

    location = Location(lat, lon, tz="UTC", altitude=altitude)
    system = PVSystem(arrays=arrays, inverter_parameters=inverter_parameters)
    # Every irradiance is a mean over its interval: the sun is placed at the
    # middle of each interval, and the results dated back at its start.
    half = pd.Timedelta(hours=step_h / 2)
    middle = weather.index + half

    meta_models = {
        "dc": dc_model,
        "ac": ac_model,
        "aoi": aoi,
        "spectral": spectral,
        "temperature": temperature_model,
        "losses": {"remaining_fraction": round(remaining, 9), "applied_to": "dc, in order", "list": losses},
    }
    try:
        mc = ModelChain(
            system,
            location,
            dc_model=dc_model,
            ac_model=no_inverter if ac_model == "no_loss" else ac_model,
            aoi_model=aoi,
            spectral_model=spectral,
            temperature_model=temperature_model,
            losses_model=ordered_losses,
            transposition_model=models.get("transposition") or "haydavies",
        )
        if poa:
            if aoi != "no_loss":
                raise Refusal("weather_incomplete", f"aoi model {aoi} needs the beam on the plane; give ghi (and dni, dhi) instead of poa_irradiance, or aoi no_loss")
            frames = []
            for a in request_arrays:
                f = weather[["temp_air", "wind_speed"]].copy()
                f["poa_global"] = poa[a["name"]]
                # Only the global is known: all of it counts as diffuse, so
                # that no incidence correction is applied to it.
                f["poa_direct"] = 0.0
                f["poa_diffuse"] = f["poa_global"]
                f.index = middle
                frames.append(f)
            mc.run_model_from_poa(tuple(frames) if len(frames) > 1 else frames[0])
            meta_models["decomposition"] = "none"
            meta_models["transposition"] = "none: plane-of-array irradiance given"
        else:
            transposition = models.get("transposition")
            if transposition not in TRANSPOSITIONS:
                raise Refusal("model_unknown", f"transposition model {transposition!r}; one of {', '.join(TRANSPOSITIONS)}")
            frame = weather.copy()
            frame.index = middle
            decomposition = "none: dni and dhi given"
            if "dni" not in frame or "dhi" not in frame:
                if models.get("decomposition") not in (None, "erbs"):
                    raise Refusal("model_unknown", f"decomposition model {models.get('decomposition')!r}; this engine has erbs")
                solar = location.get_solarposition(frame.index)
                parts = pvlib.irradiance.erbs(frame["ghi"], solar["zenith"], frame.index)
                frame["dni"] = parts["dni"].fillna(0)
                frame["dhi"] = parts["dhi"].fillna(0)
                decomposition = "erbs: dni and dhi derived from ghi"
            elif "ghi" not in frame:
                solar = location.get_solarposition(frame.index)
                frame["ghi"] = frame["dhi"] + frame["dni"] * pvlib.tools.cosd(solar["zenith"]).clip(lower=0)
                decomposition = "none: ghi closed from dni and dhi"
            mc.run_model(frame)
            meta_models["decomposition"] = decomposition
            meta_models["transposition"] = transposition
    except Refusal:
        raise
    except (ValueError, KeyError) as e:
        raise Refusal("model_invalid", f"pvlib refused the model chain: {e}")

    results = mc.results
    ac = results.ac["p_mp"] if isinstance(results.ac, pd.DataFrame) else results.ac
    ac = ac.fillna(0)
    clipped_night = int((ac < 0).sum())
    energy = ac.clip(lower=0) * step_h / 1000.0
    starts = weather.index
    stamp = [t.isoformat().replace("+00:00", "Z") for t in starts]
    step = f"{int(step_h * 60)} minutes" if step_h < 1 else ("1 hour" if step_h == 1 else f"{step_h:g} hours")

    def series(quantity_code, unit, values, array=None):
        out = {
            "quantity_code": quantity_code,
            "value_kind": "interval",
            "step": step,
            "unit": unit,
            "values": [{"at": at, "value": round(float(v), 6)} for at, v in zip(stamp, values)],
        }
        if array is not None:
            out["array"] = array
        return out

    total_irrad = results.total_irrad if isinstance(results.total_irrad, tuple) else (results.total_irrad,)
    cell_temperature = results.cell_temperature if isinstance(results.cell_temperature, tuple) else (results.cell_temperature,)
    out = [series("production_energy", "kWh", energy.to_numpy())]
    for a, irrad, tcell in zip(request_arrays, total_irrad, cell_temperature):
        out.append(series("poa_irradiance", "W/m2", irrad["poa_global"].fillna(0).to_numpy(), a["name"]))
        out.append(series("module_temperature", "degC", tcell.to_numpy(), a["name"]))

    return {
        "series": out,
        "meta": {
            "pvlib": pvlib.__version__,
            "engine": f"nexgen_pvlib {__version__}",
            "models": meta_models,
            "arrays": described,
            "site": {"lat": lat, "lon": lon, "altitude_m": location.altitude, "altitude_from": "request" if altitude is not None else "pvlib's altitude lookup"},
            "weather": {"intervals": len(starts), "step": step, "irradiance": "poa_irradiance" if poa else "ghi, dni, dhi"},
            "sun_position": "middle of each interval; series dated at the start of their interval, UTC",
            "night_power_clipped_to_zero": clipped_night,
            "not_modelled": ["horizon and near shading", "snow", "soiling beyond the losses given", "bifacial rear side", "trackers"],
        },
    }


# ---------------------------------------------------------------------------
# The envelope
# ---------------------------------------------------------------------------


def answer(request):
    if not isinstance(request, dict):
        raise Refusal("request_invalid", "the request is not a JSON object")
    if request.get("describe") is True:
        return describe()
    kind = request.get("kind")
    if kind == "pv_yield":
        return pv_yield(request)
    raise Refusal("kind_unknown", f"{kind!r}; this engine accepts {', '.join(KINDS)}")


def main(stdin=None, stdout=None):
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    try:
        try:
            envelope = json.load(stdin)
        except json.JSONDecodeError as e:
            raise Refusal("request_invalid", f"the envelope is not JSON: {e}")
        if not isinstance(envelope, dict):
            raise Refusal("request_invalid", "the envelope is not a JSON object")
        if envelope.get("engine") != ENGINE:
            raise Refusal("engine_contract_mismatch", f"this is {ENGINE}, asked {envelope.get('engine')!r}")
        if envelope.get("contract") != CONTRACT:
            raise Refusal("engine_contract_mismatch", f"this engine speaks contract {CONTRACT}, asked {envelope.get('contract')!r}")
        result = answer(envelope.get("request"))
        json.dump({"engine": ENGINE, "version": version(), "contract": CONTRACT, "result": result, "log": []}, stdout, allow_nan=False)
        return 0
    except Refusal as r:
        json.dump({"error": r.name, "detail": r.detail}, stdout)
        return 1
