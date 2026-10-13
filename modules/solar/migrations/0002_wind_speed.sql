-- Nexgen OS — module `solar`: wind speed.
--
-- The cell temperature of a module depends on the wind that cools it
-- (Faiman: Tcell = Tair + G / (U0 + U1 · v)). The core has no wind speed
-- quantity, so the module publishes the one its yield runs read: the wind
-- at 10 m above ground, as weather sources give it.

set search_path = nexgen, public, extensions;

insert into quantities (code, name, unit, aggregation, qudt_quantity_kind, description, published_by) values
  ('wind_speed', 'Wind speed', 'M-PER-SEC', 'mean', 'Speed', 'Horizontal wind speed, 10 m above ground unless the series says otherwise.', 'solar');
