-- Nexgen OS — module `community`: what energy sharing reads and writes.
--
-- Decision 0041: who takes part in a project and who received how much are
-- the same participants, so energy sharing lives here. The allocation key
-- of a project is an attribute of the project, with its period and its
-- source (the general assembly that voted it); what a key reads about one
-- participant (a fixed share, a rank) is an attribute of the participant.
-- Nothing here interprets a key: an engine of the `energy_sharing` kind
-- does (packages/connectors/README.md, decision 0013), and its answer comes back as a
-- settlement (`community.settlements`): the sharing of a project over a
-- period, for all its participants, whose series are on the participants
-- (`modules/community/src/sharing.ts`).

set search_path = nexgen, extensions;

-- ---------------------------------------------------------------------------
-- settlements — what the module computed (decision 0004).
-- ---------------------------------------------------------------------------

create table community.settlements (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The project whose energy was shared.
  project_id       uuid not null references projects(id) on delete cascade,
  -- Where it comes from: the program and the version that computed it.
  provenance       text not null,
  inputs           jsonb not null,
  results          jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table community.settlements is
  'The settlements of a project: the sharing of its energy over a period among all its participants, with its inputs, its provenance (the program and version that computed it) and its results; the series a settlement wrote name it in their source. A new computation adds a settlement or replaces one.';

create index settlements_project_id_idx on community.settlements (project_id);
create trigger settlements_set_updated_at before update on community.settlements
  for each row execute function set_updated_at();
call secure_table('community.settlements', 'project_id');

-- The share of one participant in a settlement: what the account of that
-- participant reads of it (decision 0052). A settlement belongs to the
-- project and names every participant; the account of one reads its own
-- part of the results and the series written on it, and nothing of its
-- neighbours. Whoever reads the settlement reads every share the same way.
create or replace function community.settlement_share(p_settlement_id uuid, p_participant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  st community.settlements%rowtype;
  v_share jsonb;
begin
  select * into st from community.settlements where id = p_settlement_id;
  if st.id is null or not (caller_bypasses_rls() or has_capability('participant', p_participant_id, 'data.read'))
     or not exists (select 1 from participants p where p.id = p_participant_id and p.project_id = st.project_id) then
    raise exception 'settlement_not_found: %', p_settlement_id using errcode = 'no_data_found';
  end if;
  select x into v_share from jsonb_array_elements(st.results -> 'participants') x where x ->> 'id' = p_participant_id::text;
  return jsonb_build_object('settlement_id', st.id, 'project_id', st.project_id, 'provenance', st.provenance,
                            'created_at', st.created_at, 'participant', v_share);
end;
$$;

comment on function community.settlement_share(uuid, uuid) is
  'The share of one participant in a settlement: its totals and the series written on it, with the settlement''s provenance, never the other participants''. Whoever reads that participant (its account, a member, a person the project is shared with). Refuses settlement_not_found.';

grant execute on function community.settlement_share(uuid, uuid) to authenticated, service_role;

insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
  ('allocation_key', 'Allocation key',
   'How a project shares energy among its participants: {"method": "<a method an engine knows>", "parameters": {...}}, as the engine reads it.',
   'json', null, null, null, '{project}', 'community'),
  ('allocation_share', 'Allocation share',
   'The fixed share of the energy shared that a participant receives, 0 to 1, read by a key that needs one.',
   'number', 'ratio', 0, 1, '{participant}', 'community'),
  ('allocation_rank', 'Allocation rank',
   'The order a participant is served in by a key that serves in order, 1 first.',
   'integer', null, 1, null, '{participant}', 'community');

-- What an energy_sharing engine answers, beside the core's offtake and
-- injection: the part of each covered by energy shared within the project.
insert into quantities (code, name, unit, aggregation, qudt_quantity_kind, description, published_by) values
  ('shared_offtake_energy',   'Energy received from a sharing', 'KiloW-HR', 'sum', 'Energy',
   'The part of a participant''s offtake covered by energy shared within its project.', 'community'),
  ('shared_injection_energy', 'Energy given to a sharing',      'KiloW-HR', 'sum', 'Energy',
   'The part of a participant''s injection shared with the other participants of its project.', 'community');

-- ---------------------------------------------------------------------------
-- consents — what a participant agreed to, over a period.
-- ---------------------------------------------------------------------------

create table community.consent_purposes (
  code          text primary key,
  name          text not null,
  description   text,
  published_by  text not null default 'community',
  constraint consent_purposes_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table community.consent_purposes is
  'What a participant may consent to: the terms of the operation, the processing of its data, the sharing of its metering data within its project, marketing. Vocabulary: written by migrations, modules and packs.';

insert into community.consent_purposes (code, name, description) values
  ('terms',      'Terms of the operation', 'The participant adheres to the operation and its rules (statutes, members'' agreement).'),
  ('processing', 'Processing of its data',  'The participant agrees to the processing of its personal data for the operation.'),
  ('sharing',    'Sharing of its metering data', 'The participant agrees that its metering data is passed to the operation and used to share energy among its participants.'),
  ('marketing',  'Marketing',               'The participant agrees to receive offers and news.');

alter table community.consent_purposes enable row level security;
create policy community_consent_purposes_read on community.consent_purposes for select to authenticated using (true);
grant select on community.consent_purposes to authenticated;
grant select, insert, update, delete on community.consent_purposes to service_role;

create table community.consents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references organisations(id) on delete cascade,
  participant_id     uuid not null references participants(id) on delete cascade,
  purpose            text not null references community.consent_purposes(code),
  -- Given at valid_from; a revocation closes the period at valid_to.
  valid_from         timestamptz not null,
  valid_to           timestamptz,
  -- Who gave it (the person, in words) and the contact it is, when known.
  given_by           text,
  given_by_contact_id uuid references contacts(id) on delete set null,
  -- The text signed, a document of the participant.
  document_id        uuid references documents(id) on delete set null,
  revocation_reason  text,
  revoked_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint consents_period check (valid_to is null or valid_to > valid_from),
  constraint consents_revocation check (revocation_reason is null and revoked_by is null or valid_to is not null)
);

comment on table community.consents is
  'A participant''s consent to one purpose (terms, processing, sharing, marketing) over its period: given at valid_from, closed at valid_to by a revocation with its reason and who revoked it, the signed text as a document of the participant. Written by community.give_consent() and community.revoke_consent(); periods of one participant and purpose never overlap.';

create index consents_participant_idx on community.consents (participant_id, purpose);
create index consents_organisation_idx on community.consents (organisation_id);

create or replace function community.consents_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from participants where id = new.participant_id);
  if new.organisation_id is null then
    raise exception 'participant_not_found: %', new.participant_id using errcode = 'foreign_key_violation';
  end if;
  if new.document_id is not null and not exists (
       select 1 from documents d where d.id = new.document_id and d.object_kind = 'participant' and d.object_id = new.participant_id) then
    raise exception 'document_of_other_object: the signed text of a consent is a document of its participant' using errcode = 'check_violation';
  end if;
  if exists (select 1 from community.consents c
              where c.participant_id = new.participant_id and c.purpose = new.purpose and c.id <> new.id
                and tstzrange(c.valid_from, c.valid_to) && tstzrange(new.valid_from, new.valid_to)) then
    raise exception 'consent_already_given: % already holds a % consent over that period', new.participant_id, new.purpose
      using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

comment on function community.consents_check() is
  'BEFORE INSERT / UPDATE on community.consents: copies the organisation of the participant (participant_not_found); the signed text is a document of that participant (document_of_other_object); periods of one participant and purpose never overlap (consent_already_given).';

create trigger consents_check before insert or update on community.consents
  for each row execute function community.consents_check();
create trigger consents_set_updated_at before update on community.consents
  for each row execute function set_updated_at();
call secure_table('community.consents', 'project_of(''participant'', participant_id)', 'participant_id', 'account.consent');

create or replace function community.give_consent(
  p_participant_id  uuid,
  p_purpose         text,
  p_from            timestamptz,
  p_given_by        text default null,
  p_document_id     uuid default null,
  p_contact_id      uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from community.consent_purposes where code = p_purpose) then
    raise exception 'consent_purpose_unknown: %', p_purpose using errcode = 'foreign_key_violation';
  end if;
  insert into community.consents (participant_id, purpose, valid_from, given_by, given_by_contact_id, document_id)
  values (p_participant_id, p_purpose, p_from, p_given_by, p_contact_id, p_document_id)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function community.give_consent(uuid, text, timestamptz, text, uuid, uuid) is
  'Records that a participant consented to a purpose from a moment, who gave it and the signed text (a document of the participant). Refuses consent_purpose_unknown, participant_not_found, document_of_other_object, consent_already_given. Returns its id.';

create or replace function community.revoke_consent(p_consent_id uuid, p_at timestamptz, p_reason text, p_revoked_by text default null)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  c community.consents%rowtype;
begin
  select * into c from community.consents where id = p_consent_id for update;
  if c.id is null then
    raise exception 'consent_not_found: %', p_consent_id using errcode = 'no_data_found';
  end if;
  if c.valid_to is not null then
    raise exception 'consent_already_closed: % ended at %', p_consent_id, c.valid_to using errcode = 'check_violation';
  end if;
  if p_at <= c.valid_from then
    raise exception 'consent_revoked_before_given: % was given at %', p_consent_id, c.valid_from using errcode = 'check_violation';
  end if;
  update community.consents set valid_to = p_at, revocation_reason = p_reason, revoked_by = p_revoked_by where id = p_consent_id;
end;
$$;

comment on function community.revoke_consent(uuid, timestamptz, text, text) is
  'Closes a consent at the moment it was revoked, with the reason and who revoked it. Refuses consent_not_found, consent_already_closed, consent_revoked_before_given.';

-- The participants of a project taking part over [from, to) that hold no
-- consent to a purpose covering the whole period.
create or replace function community.consents_missing(p_project_id uuid, p_purpose text, p_from timestamptz, p_to timestamptz)
returns table (participant_id uuid, name text)
language sql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
  select p.id, p.name
    from participants p
   where p.project_id = p_project_id and p.country is not null
     and (p.join_date is null or p.join_date < p_to) and (p.leave_date is null or p.leave_date >= p_from)
     and not exists (select 1 from community.consents c
                      where c.participant_id = p.id and c.purpose = p_purpose
                        and c.valid_from <= p_from and (c.valid_to is null or c.valid_to >= p_to))
   order by p.name, p.id;
$$;

comment on function community.consents_missing(uuid, text, timestamptz, timestamptz) is
  'The participants of a project taking part over a period that hold no consent to a purpose covering all of it.';

grant execute on function community.give_consent(uuid, text, timestamptz, text, uuid, uuid),
  community.revoke_consent(uuid, timestamptz, text, text),
  community.consents_missing(uuid, text, timestamptz, timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- check_perimeter — whether each participant is within the perimeter.
-- ---------------------------------------------------------------------------

-- A parameter of an object, or null where nothing decides one: for a value
-- that holds for some technologies only.
create or replace function community.parameter_if_decided(p_kind text, p_id uuid, p_attribute_type text, p_at timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
begin
  return parameter_of(p_kind, p_id, p_attribute_type, p_at);
exception when no_data_found then
  return null;
end;
$$;

comment on function community.parameter_if_decided(text, uuid, text, timestamptz) is
  'parameter_of(), or null where no level decides the parameter (parameter_missing, parameter_not_decided).';

-- The rule is pack data: `sharing_perimeter`, the list of criteria any one
-- of which suffices, resolved for each participant by parameter_of() (a
-- default for the kind of the project, its region); its values are the
-- defaults the criteria read (sharing_max_distance_m, sharing_radius_m),
-- resolved for each participant too — for its density class, its
-- municipality — the smallest applying to all, as a perimeter holds for the
-- whole operation. Producers are the participants producing or
-- self-producing. A criterion that cannot be decided (no place, no
-- municipality, no substation said) answers null, never guessed.
create or replace function community.check_perimeter(p_project_id uuid, p_on date)
returns table (participant_id uuid, name text, role text, in_perimeter boolean, criteria jsonb, rule jsonb)
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_at        timestamptz := p_on::timestamptz;
  v_rule      jsonb;
  v_rule_src  jsonb;
  v_other     jsonb;
  v_ids       uuid[];
  v_producers uuid[];
  v_crit      text;
  v_value     jsonb;
  v_val       double precision;
  v_val_from  jsonb;
  v_res       jsonb;
  p           record;
  v_same      jsonb;
  v_has_grid  boolean := to_regprocedure('grid.same_substation(uuid[])') is not null;
  v_ext       jsonb;
  v_in        boolean;
  v_detail    jsonb;
  v_rows      jsonb := '[]';
begin
  if not exists (select 1 from projects where id = p_project_id) then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;
  select array_agg(x.id order by x.name, x.id), array_agg(x.id) filter (where x.role in ('producer', 'prosumer'))
    into v_ids, v_producers
    from participants x
   where x.project_id = p_project_id and x.country is not null
     and (x.join_date is null or x.join_date <= p_on) and (x.leave_date is null or x.leave_date >= p_on);
  if v_ids is null then
    raise exception 'participants_missing: the project has no participant taking part on %', p_on using errcode = 'no_data_found';
  end if;
  if v_producers is null then
    raise exception 'producer_missing: the project has no producer on %', p_on using errcode = 'no_data_found';
  end if;

  -- One rule for the operation: every participant's place gives the same.
  for p in select unnest(v_ids) id loop
    v_other := parameter_of('participant', p.id, 'sharing_perimeter', v_at);
    if v_rule_src is null then
      v_rule_src := v_other;
    elsif v_other->'value' is distinct from v_rule_src->'value' then
      raise exception 'perimeter_rule_differs: the places of the participants give % and %', v_rule_src->'value', v_other->'value'
        using errcode = 'cardinality_violation';
    end if;
  end loop;
  v_rule := v_rule_src->'value';
  if jsonb_typeof(v_rule) <> 'array' or jsonb_array_length(v_rule) = 0 or exists (
       select 1 from jsonb_array_elements_text(v_rule) c
        where c not in ('max_distance_between_members', 'radius_around_producer', 'same_municipality', 'same_substation', 'same_region')) then
    raise exception 'perimeter_rule_unknown: %', v_rule using errcode = 'invalid_parameter_value';
  end if;


  for v_crit in select jsonb_array_elements_text(v_rule) loop
    v_val := null;
    v_val_from := null;
    if v_crit in ('max_distance_between_members', 'radius_around_producer') then
      -- The value: the smallest the places of the participants give.
      for p in select unnest(v_ids) id loop
        v_value := parameter_of('participant', p.id,
                                case v_crit when 'max_distance_between_members' then 'sharing_max_distance_m' else 'sharing_radius_m' end, v_at);
        if v_val is null or (v_value->>'value')::double precision < v_val then
          v_val := (v_value->>'value')::double precision;
          v_val_from := v_value || jsonb_build_object('participant_id', p.id);
        end if;
      end loop;
    end if;

    for p in
      select x.id, x.geometry, x.municipality, x.region, x.country from participants x where x.id = any (v_ids)
    loop
      if v_crit = 'max_distance_between_members' then
        select max(ST_Distance(ST_Force2D(p.geometry)::geography, ST_Force2D(o.geometry)::geography)) into v_res
          from participants o where o.id = any (v_ids) and o.id <> p.id;
        select case when p.geometry is null or exists (select 1 from participants o where o.id = any (v_ids) and o.geometry is null) then null
                    else coalesce((v_res #>> '{}')::double precision, 0) <= v_val end,
               jsonb_build_object('value_m', v_val, 'distance_m', round(coalesce((v_res #>> '{}')::numeric, 0), 1), 'value_from', v_val_from,
                                  'measured', 'the greatest distance to another participant') into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      elsif v_crit = 'radius_around_producer' then
        select to_jsonb(min(ST_Distance(ST_Force2D(p.geometry)::geography, ST_Force2D(o.geometry)::geography))) into v_res
          from participants o where o.id = any (v_producers) and o.geometry is not null;
        select case when p.geometry is null or v_res = 'null'::jsonb then null else (v_res #>> '{}')::double precision <= v_val end,
               jsonb_build_object('value_m', v_val, 'distance_m', round((v_res #>> '{}')::numeric, 1), 'value_from', v_val_from,
                                  'measured', 'the distance to the nearest producer') into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      elsif v_crit = 'same_municipality' then
        v_ext := null;
        if p.municipality is not null and not exists (
             select 1 from participants o where o.id = any (v_producers) and o.municipality = p.municipality) then
          -- A producer of a technology may extend the perimeter to an
          -- adjacent municipality (sharing_municipality_extension_m): the
          -- limits of municipalities are not in the model, so it is said, not decided.
          select jsonb_agg(jsonb_build_object('device_id', d.id, 'value_m', (e.v->>'value')::double precision, 'source_code', e.v->>'source_code', 'reference', e.v->>'reference'))
            into v_ext
            from devices d
            cross join lateral (select community.parameter_if_decided('device', d.id, 'sharing_municipality_extension_m', v_at) v) e
           where d.participant_id = any (v_producers) and d.status <> 'removed' and e.v is not null;
        end if;
        select case when p.municipality is null or exists (select 1 from participants o where o.id = any (v_producers) and o.municipality is null) then null
                    when exists (select 1 from participants o where o.id = any (v_producers) and o.municipality = p.municipality) then true
                    when v_ext is not null then null
                    else false end,
               jsonb_strip_nulls(jsonb_build_object('municipality', p.municipality,
                 'producers', (select jsonb_agg(distinct o.municipality) from participants o where o.id = any (v_producers)),
                 'extension', v_ext)) into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      elsif v_crit = 'same_substation' then
        if v_has_grid then
          execute 'select grid.same_substation($1)' into v_same using array_append(v_producers, p.id);
        end if;
        select case when v_has_grid then (v_same->>'same')::boolean end,
               case when v_has_grid then jsonb_build_object('substations', v_same->'substations')
                    else jsonb_build_object('note', 'the grid module is not installed') end into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      elsif v_crit = 'same_region' then
        select case when p.region is null or exists (select 1 from participants o where o.id = any (v_producers) and o.region is null) then null
                    else not exists (select 1 from participants o where o.id = any (v_producers) and o.region <> p.region) end,
               jsonb_build_object('region', p.region) into v_in, v_detail;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('participant_id', p.id, 'criterion', v_crit, 'in', v_in) || coalesce(v_detail, '{}'));
      end if;
    end loop;
  end loop;

  return query
    select x.id, x.name, x.role,
           case when bool_or((r.row->>'in')::boolean) then true
                when count(*) filter (where (r.row->>'in') is null) > 0 then null else false end,
           jsonb_agg(r.row - 'participant_id' order by r.n),
           jsonb_build_object('criteria', v_rule, 'level', v_rule_src->'level', 'region', v_rule_src->'region', 'country', v_rule_src->'country',
                              'conditions', v_rule_src->'conditions', 'source_code', v_rule_src->'source_code', 'reference', v_rule_src->'reference')
      from participants x
      join jsonb_array_elements(v_rows) with ordinality r(row, n) on (r.row->>'participant_id')::uuid = x.id
     group by x.id, x.name, x.role
     order by x.name, x.id;
end;
$$;

comment on function community.check_perimeter(uuid, date) is
  'Whether each participant of a project taking part on a day is within the perimeter of the operation: the rule (sharing_perimeter, criteria any one of which suffices) and its values (sharing_max_distance_m, sharing_radius_m, the smallest any participant''s place gives) are pack data read by parameter_of(); per participant, {in_perimeter, criteria: [{criterion, in, value_m, distance_m, value_from…}], rule: {criteria, level, conditions, source_code, reference}}. A criterion that cannot be decided answers null. Refuses project_not_found, participants_missing, producer_missing, perimeter_rule_differs, perimeter_rule_unknown, parameter_missing.';

grant execute on function community.check_perimeter(uuid, date) to authenticated, service_role;

update modules set version = '0.3.0',
       description = 'Energy sharing among the participants of a project of the core: the allocation key of the project and what it reads about each participant, as attributes, and the shares an engine computes, recorded as settlements; the consents of its participants and the perimeter of the operation, checked against the rule of its pack.'
 where code = 'community';
