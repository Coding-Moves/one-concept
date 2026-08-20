-- 0003_seed_topics.sql — the five topics the app already ships.
-- Slugs are stable identifiers; `name` is what the UI renders.

begin;

insert into public.topics (slug, name, description, sort_order) values
  ('artificial-intelligence', 'Artificial Intelligence',
   'Machine learning, deep learning, LLMs, computer vision, and NLP.', 1),
  ('software-engineering', 'Software Engineering',
   'Architecture, APIs, databases, testing, design patterns, and delivery.', 2),
  ('computer-science', 'Computer Science',
   'Algorithms, data structures, operating systems, networks, and compilers.', 3),
  ('mathematics', 'Mathematics',
   'Algebra, calculus, probability, statistics, and the mathematics behind AI.', 4),
  ('linux-systems', 'Linux & Systems',
   'The kernel, processes, filesystems, networking, and system administration.', 5)
on conflict (slug) do update
  set name        = excluded.name,
      description = excluded.description,
      sort_order  = excluded.sort_order;

commit;
