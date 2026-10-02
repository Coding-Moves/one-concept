"""Safe public attribution, selected in the same statement as the lesson body."""

from app.services.editorial_revisions import SNAPSHOT

# The calling query must name the concepts row c. A separate lookup after
# fetching the body could observe a different publication under READ COMMITTED.
# Project only these public fields, never the private event/actor identifiers.
REVIEW_ATTRIBUTION_SQL = f"""(
    select jsonb_build_object(
        'name', e.registered_name,
        'reviewed_at', e.created_at,
        'content_version', p.content_version)
    from public.editorial_publications p
    join public.editorial_revision_events e on e.id = p.approval_id
    where p.concept_id = c.id and p.content_version = c.content_version
      and c.status = 'published' and p.snapshot = {SNAPSHOT}
      and e.concept_id = c.id and e.action in ('approved', 'attested')
)"""
