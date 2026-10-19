-- Pack be — the grid: who runs it, region by region.
--
-- One transmission operator for the country, and the distribution operators
-- each region designates: one in Flanders, one in Brussels, several in
-- Wallonia, where the municipality decides which one serves it. A Belgian
-- metering point is a GS1 Global Service Relation Number (the core
-- `gs1_gsrn` scheme), issued by the operator of the connection.
--
-- The rules of the grid (bidding zone, metering step, tariff, connection)
-- name the texts they come from and follow in a later version of the pack.
-- Numbered 0004 so that it loads after the pack's legal sources and tasks.
set search_path = nexgen, public, extensions;

