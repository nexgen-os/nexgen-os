"""The client against a real installation.

Run by ``tests/sdk-python.test.ts``, which installs a fresh database, serves
it over the Postgres protocol, and gives its URL in ``NEXGEN_DB_URL`` and
what it seeded in ``NEXGEN_SDK_FIXTURE``. Without them every test is skipped.
"""

import json
import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone

from nexgen_os import Nexgen, NexgenError

FIXTURE = json.loads(os.environ.get("NEXGEN_SDK_FIXTURE") or "null")
UTC = timezone.utc


@unittest.skipUnless(FIXTURE and os.environ.get("NEXGEN_DB_URL"), "run through tests/sdk-python.test.ts")
class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nexgen = Nexgen.connect()

    @classmethod
    def tearDownClass(cls):
        cls.nexgen.close()

    def test_reads_the_schema_version(self):
        self.assertEqual(self.nexgen.schema_version(), FIXTURE["schema_version"])

    def test_finds_the_organisation_and_its_sites(self):
        self.assertIn(FIXTURE["organisation"], [str(o["id"]) for o in self.nexgen.organisations()])
        sites = {str(s["id"]): s for s in self.nexgen.sites(FIXTURE["organisation"])}
        self.assertEqual(sites[FIXTURE["site"]]["time_zone"], "Europe/Brussels")
        self.assertIsNone(sites[FIXTURE["site_without_time_zone"]]["time_zone"])
        self.assertEqual(self.nexgen.sites(str(uuid.uuid4())), [])

    def test_places_an_object(self):
        self.assertEqual(self.nexgen.site_of(FIXTURE["meter"]), FIXTURE["site"])
        self.assertEqual(self.nexgen.country_of(FIXTURE["meter"]), FIXTURE["country"])
        self.assertIsNone(self.nexgen.site_of(str(uuid.uuid4())))

    def test_resamples_by_day_in_the_site_time_zone(self):
        days = self.nexgen.resample(
            FIXTURE["series"], datetime(2026, 6, 1, tzinfo=UTC) - timedelta(hours=2), datetime(2026, 6, 2, 22, tzinfo=UTC), "1 day"
        )
        self.assertEqual([(d.start.astimezone(UTC), d.value, d.samples) for d in days], [
            (datetime(2026, 5, 31, 22, tzinfo=UTC), 96.0, 96),
            (datetime(2026, 6, 1, 22, tzinfo=UTC), 96.0, 96),
        ])

    def test_resamples_by_hour_with_a_timedelta(self):
        hours = self.nexgen.resample(
            FIXTURE["series"], datetime(2026, 6, 1, 10, tzinfo=UTC), datetime(2026, 6, 1, 13, tzinfo=UTC), timedelta(hours=1)
        )
        self.assertEqual([(h.value, h.samples) for h in hours], [(4.0, 4)] * 3)

    def test_names_the_refusals_of_the_database(self):
        with self.assertRaises(NexgenError) as refused:
            self.nexgen.resample(FIXTURE["series_without_time_zone"], datetime(2026, 6, 1, tzinfo=UTC), datetime(2026, 6, 3, tzinfo=UTC), "1 day")
        self.assertEqual(refused.exception.code, "time_zone_required")
        with self.assertRaises(NexgenError) as refused:
            self.nexgen.resample(str(uuid.uuid4()), datetime(2026, 6, 1, tzinfo=UTC), datetime(2026, 6, 3, tzinfo=UTC), "1 hour")
        self.assertEqual(refused.exception.code, "series_not_found")
        # The connection is still usable after a refusal.
        self.assertEqual(self.nexgen.schema_version(), FIXTURE["schema_version"])

    def test_stores_through_the_one_write_path_and_reads_the_values_back(self):
        identity = {"object_id": FIXTURE["meter"], "quantity_code": "consumption_energy", "step": "1 hour"}
        start = datetime(2026, 6, 3, 8, tzinfo=UTC)
        values = [(start + timedelta(hours=i), 500.0 * (i + 1)) for i in range(3)]
        stored = self.nexgen.store(identity, values, unit="Wh")
        self.assertEqual(stored.changed, 3)
        self.assertEqual(self.nexgen.store(identity, values, unit="Wh").changed, 0)
        readings = self.nexgen.window(stored.series_id, start, start + timedelta(hours=3))
        self.assertEqual([(r.value, r.quality) for r in readings], [(0.5, 0), (1.0, 0), (1.5, 0)])
        latest = self.nexgen.latest([stored.series_id])
        self.assertEqual([(l.series_id, l.at.astimezone(UTC), l.value) for l in latest], [(stored.series_id, start + timedelta(hours=2), 1.5)])
        with self.assertRaises(NexgenError) as refused:
            self.nexgen.store(stored.series_id, [(start, 1.0)], unit="kW")
        self.assertEqual(refused.exception.code, "series_unit_mismatch")
        self.assertEqual(self.nexgen.convert_unit(1500, "W", "kW"), 1.5)

    def test_gives_rows_and_columns_through_the_optional_extras(self):
        hours = self.nexgen.resample(FIXTURE["series"], datetime(2026, 6, 1, 10, tzinfo=UTC), datetime(2026, 6, 1, 12, tzinfo=UTC), "1 hour")
        self.assertEqual(hours.columns()["samples"], [4, 4])
        self.assertEqual(hours.columns()["expected"], [4, 4])
        try:
            import pyarrow  # noqa: F401
        except ImportError:
            with self.assertRaises(NexgenError) as refused:
                hours.to_arrow()
            self.assertEqual(refused.exception.code, "extra_required")
        else:
            self.assertEqual(hours.to_arrow().num_rows, 2)

    def test_attaches_with_a_period_and_a_source_and_reads_it_back(self):
        site = FIXTURE["site"]
        first = self.nexgen.attach(
            site, "annual_consumption", 41000, source="2025 invoices",
            valid_from=datetime(2025, 1, 1, tzinfo=UTC), valid_to=datetime(2026, 1, 1, tzinfo=UTC),
        )
        self.nexgen.attach(site, "annual_consumption", 38500, source="2026 invoices", valid_from=datetime(2026, 1, 1, tzinfo=UTC))
        uuid.UUID(first)
        self.assertEqual(self.nexgen.attributes_of(site, datetime(2025, 6, 1, tzinfo=UTC)), {"annual_consumption": 41000})
        self.assertEqual(self.nexgen.attributes_of(site), {"annual_consumption": 38500})
        self.assertEqual(self.nexgen.attributes_of(site, datetime(2024, 6, 1, tzinfo=UTC)), {})

        with self.assertRaises(NexgenError) as refused:
            self.nexgen.attach(site, "annual_consumption", 1, source="a guess", valid_from=datetime(2025, 6, 1, tzinfo=UTC))
        self.assertEqual(refused.exception.code, "overlapping_value")
        with self.assertRaises(NexgenError) as refused:
            self.nexgen.attach(FIXTURE["meter"], "annual_consumption", -5, source="a reading")
        self.assertIn(refused.exception.code, ("property_not_applicable", "invalid_value"))

    def test_refuses_a_value_without_a_source(self):
        with self.assertRaises(NexgenError) as refused:
            self.nexgen.attach(FIXTURE["site"], "annual_consumption", 1)
        self.assertEqual(refused.exception.code, "source_required")


class ConnectTest(unittest.TestCase):
    def test_needs_a_connection_string(self):
        saved = os.environ.pop("NEXGEN_DB_URL", None)
        try:
            with self.assertRaises(NexgenError) as refused:
                Nexgen.connect()
            self.assertEqual(refused.exception.code, "db_url_required")
        finally:
            if saved is not None:
                os.environ["NEXGEN_DB_URL"] = saved


if __name__ == "__main__":
    unittest.main()
