-- Nexgen OS — module `actions`: where the devices of a works stand.
--
-- A works is followed by its actions and by the devices it puts in place.
-- `actions.progress()` already sums the actions up; it now says too how
-- many devices of the participant, or of the participants taking part in
-- the project, are in each status of the core (planned, installed,
-- in_service, out_of_service, removed), the share in service among those
-- not removed, and the ones not yet in service — what a site board shows.
-- A device's status is its own, as the core keeps it: the module reads it,
-- never writes it.

set search_path = nexgen, extensions;

create or replace function actions.progress(p_object_id uuid, p_on date)
returns jsonb
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with nodes as (
    select p_object_id as id
    union
    select p.id from participants p where p.project_id = p_object_id
  ),
  m as (
    select m.*, ph.position
      from actions.actions m
      join actions.phases ph on ph.code = m.phase
     where (m.object_id = p_object_id or participant_of(m.object_kind, m.object_id) in (select id from nodes))
  ),
  d as (
    select d.id, d.name, d.device_type, d.status
      from devices d
     where d.participant_id in (select id from nodes)
  ),
  devices_summary as (
    select jsonb_build_object(
      'total', count(*),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from d group by status) s), '{}'::jsonb),
      'in_service_share', case when count(*) filter (where status <> 'removed') = 0 then null
                               else round(count(*) filter (where status = 'in_service')::numeric / count(*) filter (where status <> 'removed'), 4) end,
      'not_in_service', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'device_type', o.device_type, 'status', o.status) order by o.name, o.id)
                                    from d o where o.status not in ('in_service', 'removed')), '[]'::jsonb)
    ) j
    from d
  )
  select jsonb_build_object(
    'on', p_on,
    'total', count(*),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from m group by status) s), '{}'::jsonb),
    'done_share', case when count(*) filter (where status <> 'dismissed') = 0 then null
                       else round(count(*) filter (where status = 'done')::numeric / count(*) filter (where status <> 'dismissed'), 4) end,
    'late', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'phase', l.phase, 'planned_end', l.planned_end) order by l.planned_end, l.name)
                        from m l where l.status not in ('done', 'failed', 'dismissed') and l.planned_end < p_on), '[]'::jsonb),
    'current_phase', (select o.phase from m o where o.status not in ('done', 'failed', 'dismissed') order by o.position, o.planned_start nulls last, o.name limit 1),
    'devices', (select j from devices_summary)
  )
  from m;
$$;

comment on function actions.progress(uuid, date) is
  'Where a participant or a project stands on a day: actions by status, share done, the late ones (not done, failed or dismissed), the current phase; and its devices by status, the share in service among those not removed, the ones not yet in service. Reads under the caller''s row level security.';

grant execute on function actions.progress(uuid, date) to authenticated, service_role;

update modules
   set description = 'What has to be done on an object of the core, now or later: steps of a project planned from templates per country, region and condition, recommendations resting on an estimate, commands asked of a device in real time — one lifecycle for all three — and the progress of a participant or a project on a day, its actions and its devices.'
 where code = 'actions';
