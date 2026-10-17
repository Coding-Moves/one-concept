-- Private, cursor-bounded revision history for an existing concept.
begin;

create function public.edge_api_editorial_revision_history(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_concept_id uuid, p_cursor uuid, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_items jsonb;
  v_next uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    return jsonb_build_object('error', 'invalid_page');
  end if;
  v_actor := public.edge_api_editorial_authorize_any(
    p_user_id, p_session_id, p_aal, array['review','approve','publish']);
  if v_actor ? 'error' then return v_actor; end if;
  if p_concept_id is null or not exists(
    select 1 from public.concepts where id=p_concept_id
  ) then
    return jsonb_build_object('error', 'concept_not_found');
  end if;
  with page as (
    select r.id, jsonb_build_object(
      'id',r.id,'base_version',r.base_version,'status',r.status,
      'created_at',r.created_at,'assigned_to',r.assigned_to
    ) as item
    from public.concept_revisions r
    where r.concept_id=p_concept_id and (p_cursor is null or r.id>p_cursor)
    order by r.id limit p_limit+1
  ), numbered as (
    select page.*,row_number() over(order by id) as position from page
  )
  select coalesce(jsonb_agg(item order by id) filter(where position<=p_limit), '[]'::jsonb),
         (select id from numbered where position=p_limit
           and exists(select 1 from numbered where position>p_limit))
    into v_items,v_next from numbered;
  return jsonb_build_object('items',v_items,'next_cursor',v_next);
end
$$;

revoke all on function public.edge_api_editorial_revision_history(uuid,uuid,text,uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.edge_api_editorial_revision_history(uuid,uuid,text,uuid,uuid,integer)
  to service_role;

commit;
