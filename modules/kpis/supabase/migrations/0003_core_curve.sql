-- Nexgen OS — indicators: a participant's variable is read as the core
-- reads its curve.
--
-- `variable_series()` chose, for a variable that names no kind, the
-- measured series and else the simulated ones — the choice the core makes
-- once for every module in `participant_curve_series()`. For a participant
-- it now reads that function, so the indicators, the consumption curve and
-- the battery read the same series of a participant, of the same kind. A
-- project (each of its participants together), a meter or a device, and a
-- variable that names its kind, are read as before.

set search_path = nexgen, extensions;

create or replace function kpis.variable_series(p_kind text, p_id uuid, p_quantity text, p_series_kind text,
                                                p_from timestamptz default null, p_to timestamptz default null)
returns table (ids uuid[], kind text)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k text;
begin
  if p_kind = 'participant' and p_series_kind is null then
    select array_agg(c.series_id order by c.series_id), min(c.kind)
      into ids, kind
      from participant_curve_series(p_id, p_quantity, p_from, p_to) c;
    ids := coalesce(ids, '{}');
    return next;
    return;
  end if;
  foreach k in array case when p_series_kind is not null then array[p_series_kind] else array['measured', 'simulated'] end loop
    ids := array(select s from kpis.series_of(p_kind, p_id, p_quantity, k, p_from, p_to) s
                  where not exists (select 1 from series se where se.id = s and se.source like 'kpis.figures:%'));
    kind := k;
    if cardinality(ids) > 0 then
      return next;
      return;
    end if;
  end loop;
  ids := '{}';
  kind := null;
  return next;
end;
$$;

comment on function kpis.variable_series(text, uuid, text, text, timestamptz, timestamptz) is
  'The series of a variable over the period it is read, with their kind: for a participant and a variable naming no kind, participant_curve_series() of the core (measured, else simulated); otherwise the series of its kind, or the measured ones and else the simulated ones. Never a figure this module wrote back.';
