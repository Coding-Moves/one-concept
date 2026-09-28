-- Two-level curriculum taxonomy. Topics remain the user-facing follow level;
-- subtopics classify concepts and planned content within a topic.
begin;

create table public.subtopics (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 2 and 80),
  description text,
  sort_order smallint not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (topic_id, slug),
  unique (id, topic_id)
);

create index subtopics_active_topic_order_idx
  on public.subtopics(topic_id, sort_order, name) where is_active;
alter table public.subtopics enable row level security;

alter table public.concepts add column subtopic_id uuid;
alter table public.concept_backlog add column subtopic_id uuid;
create index concepts_subtopic_published_idx
  on public.concepts(subtopic_id) where status = 'published';
create index concept_backlog_subtopic_pending_idx
  on public.concept_backlog(subtopic_id) where status = 'pending';

insert into public.subtopics(topic_id, slug, name, description, sort_order)
select t.id, v.slug, v.name, v.description, v.sort_order
from (values
  ('artificial-intelligence', 'core-concepts', 'Core Concepts', 'Foundational artificial-intelligence concepts.', 1),
  ('artificial-intelligence', 'optimization', 'Optimization', 'Objectives, gradients, and training updates.', 2),
  ('artificial-intelligence', 'model-evaluation', 'Model Evaluation', 'Generalization, evaluation, and error analysis.', 3),
  ('artificial-intelligence', 'transformer-architectures', 'Transformer Architectures', 'Attention-based model architecture.', 4),
  ('artificial-intelligence', 'representation-learning', 'Representation Learning', 'Embeddings and learned representations.', 5),
  ('software-engineering', 'core-concepts', 'Core Concepts', 'Foundational software-engineering concepts.', 1),
  ('software-engineering', 'reliability', 'Reliability', 'Retries, idempotency, and resilient systems.', 2),
  ('software-engineering', 'performance', 'Performance', 'Caching and efficient system design.', 3),
  ('software-engineering', 'api-design', 'API Design', 'HTTP APIs and service interfaces.', 4),
  ('software-engineering', 'databases', 'Databases', 'Indexes, transactions, and data storage.', 5),
  ('computer-science', 'core-concepts', 'Core Concepts', 'Foundational computer-science concepts.', 1),
  ('computer-science', 'algorithm-analysis', 'Algorithm Analysis', 'Asymptotic reasoning and complexity.', 2),
  ('computer-science', 'data-structures', 'Data Structures', 'Organizing data for efficient operations.', 3),
  ('computer-science', 'programming-paradigms', 'Programming Paradigms', 'Ways to structure computation.', 4),
  ('computer-science', 'concurrency', 'Concurrency', 'Coordination and resource contention.', 5),
  ('mathematics', 'core-concepts', 'Core Concepts', 'Foundational mathematics concepts.', 1),
  ('mathematics', 'probability', 'Probability', 'Reasoning under uncertainty.', 2),
  ('mathematics', 'linear-algebra', 'Linear Algebra', 'Vectors, spaces, and transformations.', 3),
  ('linux-systems', 'core-concepts', 'Core Concepts', 'Foundational Linux and systems concepts.', 1),
  ('linux-systems', 'process-management', 'Process Management', 'Processes, process life cycles, and signals.', 2),
  ('linux-systems', 'input-output', 'Input and Output', 'File descriptors, streams, and redirection.', 3),
  ('linux-systems', 'network-security', 'Network Security', 'Secure remote access and networking.', 4),
  ('linux-systems', 'service-management', 'Service Management', 'System services and supervision.', 5)
) as v(topic_slug, slug, name, description, sort_order)
join public.topics t on t.slug = v.topic_slug;

-- The original twenty published articles are classified explicitly. Any later
-- legacy article that predates this migration is intentionally placed in its
-- topic's reviewed Core Concepts subtopic; it is never left unclassified.
update public.concepts c
set subtopic_id = s.id
from (values
  ('idempotency', 'software-engineering', 'reliability'),
  ('gradient-descent', 'artificial-intelligence', 'optimization'),
  ('big-o-notation', 'computer-science', 'algorithm-analysis'),
  ('bayes-theorem', 'mathematics', 'probability'),
  ('linux-processes', 'linux-systems', 'process-management'),
  ('caching', 'software-engineering', 'performance'),
  ('overfitting', 'artificial-intelligence', 'model-evaluation'),
  ('hash-tables', 'computer-science', 'data-structures'),
  ('linear-independence', 'mathematics', 'linear-algebra'),
  ('file-descriptors', 'linux-systems', 'input-output'),
  ('rest-apis', 'software-engineering', 'api-design'),
  ('attention-mechanism', 'artificial-intelligence', 'transformer-architectures'),
  ('recursion', 'computer-science', 'programming-paradigms'),
  ('probability-distributions', 'mathematics', 'probability'),
  ('ssh', 'linux-systems', 'network-security'),
  ('database-indexes', 'software-engineering', 'databases'),
  ('embeddings', 'artificial-intelligence', 'representation-learning'),
  ('deadlock', 'computer-science', 'concurrency'),
  ('expected-value', 'mathematics', 'probability'),
  ('systemd-services', 'linux-systems', 'service-management')
) as m(concept_slug, topic_slug, subtopic_slug)
join public.topics t on t.slug = m.topic_slug
join public.subtopics s on s.topic_id = t.id and s.slug = m.subtopic_slug
where c.slug = m.concept_slug and c.topic_id = t.id;

update public.concepts c
set subtopic_id = s.id
from public.subtopics s
where s.topic_id = c.topic_id and s.slug = 'core-concepts'
  and c.subtopic_id is null;

-- Editorial revisions are validated independently of their current concept.
-- Preserve the same classification in every existing body before requiring it
-- for all new drafts.
update public.concept_revisions r
set body = jsonb_set(r.body, '{subtopic_slug}', to_jsonb(s.slug), true)
from public.concepts c
join public.subtopics s on s.id = c.subtopic_id
where r.concept_id = c.id and not (r.body ? 'subtopic_slug');

alter table public.concepts
  add constraint concepts_subtopic_topic_fkey
  foreign key (subtopic_id, topic_id) references public.subtopics(id, topic_id) not valid;
alter table public.concept_backlog
  add constraint concept_backlog_subtopic_topic_fkey
  foreign key (subtopic_id, topic_id) references public.subtopics(id, topic_id) not valid;
alter table public.concepts validate constraint concepts_subtopic_topic_fkey;
alter table public.concept_backlog validate constraint concept_backlog_subtopic_topic_fkey;
alter table public.concepts alter column subtopic_id set not null;

commit;
