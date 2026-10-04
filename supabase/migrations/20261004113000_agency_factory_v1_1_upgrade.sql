-- SYSTEM B Agency Factory V1.1 hardening
-- Adds an explicit suspended-tenant upgrade path and provenance-backed learning access.
-- Additive only: no existing Factory V1 function is weakened or removed.

create or replace function public.apply_agency_factory_v1_1_learning_access(
  p_run_id uuid,
  p_expected_revision bigint,
  p_manifest_hash text,
  p_actor_ref text,
  p_access_grants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_run public.agency_provisioning_runs%rowtype;
  v_agency_status text;
  v_grant jsonb;
  v_email text;
  v_user_id uuid;
  v_course_code text;
  v_canonical_id uuid;
  v_membership_id uuid;
  v_entitlement_id uuid;
  v_source_ref text;
  v_count int := 0;
begin
  select * into v_run
  from public.agency_provisioning_runs
  where id = p_run_id
  for update;

  if not found then raise exception 'factory_run_not_found'; end if;
  if v_run.revision <> p_expected_revision then raise exception 'factory_stale_revision'; end if;
  if v_run.actor_ref <> p_actor_ref then raise exception 'factory_actor_mismatch'; end if;
  if v_run.manifest_hash <> p_manifest_hash then raise exception 'factory_run_binding_mismatch'; end if;
  if v_run.agency_id is null then raise exception 'factory_agency_not_applied'; end if;
  if v_run.phase not in ('PREPARING','READY','BLOCKED') then
    raise exception 'factory_learning_access_phase_invalid';
  end if;

  select status into v_agency_status
  from public.agencies
  where id = v_run.agency_id and slug = v_run.target_slug
  for update;

  if v_agency_status is null then raise exception 'factory_target_ownership_mismatch'; end if;
  if v_agency_status <> 'suspended' then raise exception 'factory_learning_access_requires_suspended_tenant'; end if;

  if p_access_grants is null then
    p_access_grants := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_access_grants) <> 'array' then
    raise exception 'factory_learning_access_invalid';
  end if;

  for v_grant in select value from jsonb_array_elements(p_access_grants) loop
    v_email := lower(btrim(coalesce(v_grant->>'principal_email','')));
    v_user_id := nullif(v_grant->>'principal_user_id','')::uuid;
    v_course_code := btrim(coalesce(v_grant->>'canonical_course_code',''));

    if v_user_id is null and v_email <> '' then
      select id into v_user_id from auth.users where lower(email) = v_email limit 1;
    elsif v_user_id is not null and v_email <> '' then
      if not exists (
        select 1 from auth.users
        where id = v_user_id and lower(email) = v_email
      ) then
        raise exception 'factory_learning_access_identity_mismatch';
      end if;
    end if;

    if v_user_id is null then raise exception 'factory_learning_access_principal_not_ready'; end if;

    select id into v_canonical_id
    from public.canonical_courses
    where code = v_course_code
    limit 1;

    if v_canonical_id is null then
      raise exception 'factory_learning_access_course_not_ready: %', v_course_code;
    end if;

    select id into v_membership_id
    from public.agency_memberships
    where agency_id = v_run.agency_id
      and user_id = v_user_id
      and status = 'active'
    limit 1;

    if v_membership_id is null then
      raise exception 'factory_learning_access_membership_not_ready';
    end if;

    insert into public.student_entitlements (
      agency_id, membership_id, canonical_course_id, status, expires_at
    )
    values (
      v_run.agency_id, v_membership_id, v_canonical_id, 'active', null
    )
    on conflict (agency_id, membership_id, canonical_course_id)
    do update set status = 'active', expires_at = null
    returning id into v_entitlement_id;

    v_source_ref := 'factory:' || v_run.id::text || ':' || v_user_id::text || ':' || v_canonical_id::text;

    insert into public.entitlement_grants (
      agency_id, entitlement_id, source_type, source_reference_id,
      notes, status, granted_at, expires_at, revoked_at, revoked_reason
    )
    values (
      v_run.agency_id, v_entitlement_id, 'manual_admin', v_source_ref,
      'Agency Factory baseline learning access', 'active', now(), null, null, null
    )
    on conflict (agency_id, entitlement_id, source_type, source_reference_id)
    do update set
      status = 'active',
      expires_at = null,
      revoked_at = null,
      revoked_reason = null,
      notes = excluded.notes;

    perform public.recompute_effective_entitlement(v_run.agency_id, v_entitlement_id);
    v_count := v_count + 1;
  end loop;

  update public.agency_provisioning_runs
  set step_results = step_results || jsonb_build_object(
        'learning_access',
        jsonb_build_object('status','PASS','count',v_count,'at',now())
      ),
      last_error_code = null,
      updated_at = now(),
      revision = revision + 1
  where id = v_run.id
    and revision = p_expected_revision
  returning * into v_run;

  if not found then raise exception 'factory_stale_revision'; end if;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_run.id,
    'agency_id', v_run.agency_id,
    'count', v_count,
    'phase', v_run.phase,
    'revision', v_run.revision
  );
end;
$function$;

revoke all on function public.apply_agency_factory_v1_1_learning_access(uuid,bigint,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_agency_factory_v1_1_learning_access(uuid,bigint,text,text,jsonb)
  to service_role;


create or replace function public.upgrade_agency_factory_v1_1_atomic(
  p_run_id uuid,
  p_expected_revision bigint,
  p_manifest jsonb,
  p_manifest_hash text,
  p_manifest_summary jsonb,
  p_profile text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_run public.agency_provisioning_runs%rowtype;
  v_agency_status text;
  v_agency_slug text;
  v_target_rank int;
  v_current_rank int;
  v_staged jsonb;
  v_offerings jsonb;
  v_engine_manifest jsonb;
  v_result jsonb;
  v_result_agency_id uuid;
  v_course jsonb;
  v_code text;
  v_v5_course_id uuid;
  v_canonical_id uuid;
  v_existing_course_id uuid;
  v_release_id uuid;
  v_matching_domains int;
  v_history jsonb;
begin
  if p_run_id is null
     or p_expected_revision is null
     or p_manifest is null
     or btrim(coalesce(p_manifest_hash,'')) = '' then
    raise exception 'factory_upgrade_invalid_input';
  end if;

  if p_profile not in ('TENANT_SHELL','LEARNING_READY','COMMERCE_TEST_READY') then
    raise exception 'factory_invalid_profile';
  end if;

  select * into v_run
  from public.agency_provisioning_runs
  where id = p_run_id
  for update;

  if not found then raise exception 'factory_run_not_found'; end if;
  if v_run.revision <> p_expected_revision then raise exception 'factory_stale_revision'; end if;
  if v_run.actor_ref <> p_actor_ref then raise exception 'factory_actor_mismatch'; end if;
  if v_run.agency_id is null then raise exception 'factory_agency_not_applied'; end if;

  -- A response-lost retry after a committed upgrade is safe and idempotent.
  if v_run.manifest_hash = p_manifest_hash and v_run.profile = p_profile
     and v_run.phase in ('PREPARING','READY') then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'run_id', v_run.id,
      'agency_id', v_run.agency_id, 'phase', v_run.phase, 'revision', v_run.revision
    );
  end if;

  if v_run.phase <> 'READY' then
    raise exception 'factory_upgrade_requires_ready_suspended_run';
  end if;

  select slug, status into v_agency_slug, v_agency_status
  from public.agencies
  where id = v_run.agency_id
  for update;

  if v_agency_slug is null or v_agency_slug <> v_run.target_slug then
    raise exception 'factory_target_ownership_mismatch';
  end if;
  if v_agency_status <> 'suspended' then
    raise exception 'factory_upgrade_requires_suspended_tenant';
  end if;
  if lower(btrim(p_manifest->'agency'->>'slug')) <> v_run.target_slug then
    raise exception 'factory_target_mismatch';
  end if;

  v_current_rank := case v_run.profile
    when 'TENANT_SHELL' then 1
    when 'LEARNING_READY' then 2
    when 'COMMERCE_TEST_READY' then 3
    else 0
  end;
  v_target_rank := case p_profile
    when 'TENANT_SHELL' then 1
    when 'LEARNING_READY' then 2
    when 'COMMERCE_TEST_READY' then 3
    else 0
  end;

  if v_target_rank < v_current_rank then
    raise exception 'factory_profile_downgrade_forbidden';
  end if;

  if jsonb_typeof(p_manifest->'domains') <> 'array'
     or jsonb_array_length(p_manifest->'domains') <> 2 then
    raise exception 'factory_requires_exactly_two_typed_hosts';
  end if;

  select count(*) into v_matching_domains
  from jsonb_array_elements(p_manifest->'domains') d
  join public.agency_domains ad
    on ad.agency_id = v_run.agency_id
   and ad.hostname = lower(btrim(d->>'hostname'))
   and ad.surface = lower(btrim(d->>'surface'))
   and ad.status = 'active'
   and ad.ssl_status = 'active'
   and ad.is_primary = true;

  if v_matching_domains <> 2 then
    raise exception 'factory_upgrade_domain_set_mismatch';
  end if;

  -- Re-validate shared canonical content without allowing the generic engine
  -- to rewrite canonical course or lesson metadata.
  if jsonb_typeof(p_manifest->'learning'->'courses') = 'array' then
    for v_course in select value from jsonb_array_elements(p_manifest->'learning'->'courses') loop
      v_code := btrim(v_course->>'code');
      v_v5_course_id := nullif(v_course->>'course_id','')::uuid;

      select id, course_id into v_canonical_id, v_existing_course_id
      from public.canonical_courses
      where code = v_code;

      if v_canonical_id is null then
        raise exception 'factory_prepared_canonical_course_required: %', v_code;
      end if;
      if v_existing_course_id is distinct from v_v5_course_id then
        raise exception 'factory_canonical_course_mapping_conflict: %', v_code;
      end if;

      select published_release_id into v_release_id
      from public.v5_course_configs
      where course_id = v_v5_course_id and status = 'published';

      if v_release_id is null or not exists (
        select 1 from public.v5_releases
        where id = v_release_id
          and course_id = v_v5_course_id
          and status = 'published'
      ) then
        raise exception 'factory_prepared_v5_release_required: %', v_code;
      end if;
    end loop;
  end if;

  -- All upgrade writes are staged. The tenant stays suspended and every
  -- offering stays unpublished until validation + explicit resume/activate.
  v_staged := jsonb_set(
    p_manifest,
    '{agency}',
    coalesce(p_manifest->'agency','{}'::jsonb) || jsonb_build_object('status','suspended'),
    true
  );

  if jsonb_typeof(v_staged->'offerings') = 'array' then
    select coalesce(
      jsonb_agg(value || jsonb_build_object('is_published', false)),
      '[]'::jsonb
    )
    into v_offerings
    from jsonb_array_elements(v_staged->'offerings');

    v_staged := jsonb_set(v_staged, '{offerings}', v_offerings, true);
  end if;

  -- Never pass learning to the legacy upsert engine: shared canonical content
  -- remains platform-owned and immutable from Factory upgrade flows.
  v_engine_manifest := v_staged - 'learning';

  perform pg_advisory_xact_lock(hashtext('agency_factory_v1:' || v_run.target_slug));
  perform pg_advisory_xact_lock(hashtext('agency_provision:' || v_run.target_slug));

  select public.provision_agency_manifest_atomic(v_engine_manifest, false, null)
    into v_result;

  v_result_agency_id := nullif(v_result->>'agency_id','')::uuid;
  if v_result_agency_id is null or v_result_agency_id <> v_run.agency_id then
    raise exception 'factory_upgrade_target_mismatch';
  end if;

  v_history := coalesce(v_run.resource_ledger->'upgrade_history','[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'from_profile', v_run.profile,
      'from_manifest_hash', v_run.manifest_hash,
      'from_revision', v_run.revision,
      'at', now()
    ));

  update public.agency_provisioning_runs
  set profile = p_profile,
      manifest_version = coalesce((p_manifest->>'version')::int, manifest_version),
      manifest_hash = p_manifest_hash,
      manifest_summary = coalesce(p_manifest_summary,'{}'::jsonb),
      provider_readiness = coalesce(p_manifest->'provider_readiness','{}'::jsonb),
      phase = 'PREPARING',
      last_error_code = null,
      step_results = step_results || jsonb_build_object(
        'upgrade_apply',
        jsonb_build_object('status','PASS','to_profile',p_profile,'at',now())
      ),
      resource_ledger = jsonb_set(
        coalesce(resource_ledger,'{}'::jsonb),
        '{upgrade_history}',
        v_history,
        true
      ),
      updated_at = now(),
      revision = revision + 1
  where id = v_run.id
    and revision = p_expected_revision
  returning * into v_run;

  if not found then raise exception 'factory_stale_revision'; end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'run_id', v_run.id,
    'agency_id', v_run.agency_id,
    'phase', v_run.phase,
    'profile', v_run.profile,
    'revision', v_run.revision
  );
end;
$function$;

revoke all on function public.upgrade_agency_factory_v1_1_atomic(uuid,bigint,jsonb,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.upgrade_agency_factory_v1_1_atomic(uuid,bigint,jsonb,text,jsonb,text,text)
  to service_role;
