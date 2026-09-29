-- A reviewed recall prompt belongs to the published lesson version. Legacy
-- lessons remain null until an editor approves a real flashcard for them.
begin;

alter table public.concepts add column flashcard jsonb;

alter table public.concepts add constraint concepts_flashcard_shape check (
  flashcard is null or (
    jsonb_typeof(flashcard) = 'object'
    and jsonb_typeof(flashcard->'front') = 'string'
    and jsonb_typeof(flashcard->'back') = 'string'
    and length(btrim(flashcard->>'front')) between 12 and 280
    and length(btrim(flashcard->>'back')) between 12 and 500
  )
);

commit;
