-- 0004_seed_concepts.sql — the 20 hand-written concepts from the prototype.
--
-- GENERATED from mobile/src/data/concepts.ts. These become the 'seed' rows and
-- double as few-shot examples for the Gemini prompt in Phase 6, so they define
-- the house voice. Re-running is safe: it updates text in place by slug.

begin;

insert into public.concepts (slug, topic_id, title, summary, example, source, status)
select v.slug, t.id, v.title, v.summary, v.example, 'seed', 'published'
from (values
  ('idempotency', 'software-engineering', 'Idempotency',
   'An operation is idempotent when performing it multiple times produces the same final result as performing it once. This matters when designing reliable APIs and distributed systems: if a network request times out, the client can safely retry an idempotent operation without fear of double-charging a card or creating duplicate records.',
   'HTTP PUT is idempotent: setting a user’s email to "a@b.com" twice leaves the same state. POST is typically not: submitting an order twice creates two orders, which is why payment APIs use idempotency keys.'),
  ('gradient-descent', 'artificial-intelligence', 'Gradient Descent',
   'Gradient descent is the optimization algorithm at the heart of most machine learning. It minimizes a loss function by repeatedly measuring the slope (gradient) of the loss with respect to the model’s parameters and taking a small step in the opposite direction — downhill — until the loss stops improving.',
   'Training a neural network is millions of tiny parameter nudges: compute how wrong the prediction was, compute the gradient via backpropagation, and step each weight slightly against its gradient.'),
  ('big-o-notation', 'computer-science', 'Big-O Notation',
   'Big-O notation describes how an algorithm’s running time or memory grows as its input grows, ignoring constant factors. It lets you compare algorithms by their scaling behavior rather than their speed on one machine.',
   'Searching a sorted array with binary search is O(log n): doubling the input adds one extra step. A linear scan is O(n): doubling the input doubles the work.'),
  ('bayes-theorem', 'mathematics', 'Bayes’ Theorem',
   'Bayes’ theorem tells you how to update a belief when new evidence arrives: the probability of a hypothesis given the evidence is proportional to how likely the evidence is under that hypothesis, times how plausible the hypothesis was before. It is the mathematical backbone of spam filters, medical test interpretation, and probabilistic AI.',
   'A disease test that is 99% accurate can still mean a positive result is probably false — if the disease is rare enough, false positives outnumber true ones.'),
  ('linux-processes', 'linux-systems', 'Processes and fork()',
   'A process is a running program with its own memory, file descriptors, and identity (PID). On Linux, new processes are created by fork(), which clones the calling process, usually followed by exec(), which replaces the clone’s program with a new one. Every process you run descends from this fork/exec chain.',
   'When you type "ls" in a shell, the shell forks a child, the child execs /bin/ls, and the shell waits for it to exit — that exit status is what $? contains.'),
  ('caching', 'software-engineering', 'Caching',
   'A cache stores the result of expensive work so the next request can be served faster. The hard part is invalidation: knowing when the stored copy no longer matches the source of truth. Every cache trades freshness for speed, and good cache design makes that trade explicit with TTLs, versioned keys, or explicit invalidation.',
   'A CDN caches images near users so requests never reach your server; a browser caches API responses with Cache-Control headers; a memoized function caches results per argument.'),
  ('overfitting', 'artificial-intelligence', 'Overfitting',
   'A model overfits when it learns the noise and quirks of its training data instead of the underlying pattern, so it scores well on data it has seen and poorly on data it has not. It is the central failure mode of machine learning, countered with more data, regularization, simpler models, and honest held-out evaluation.',
   'A student who memorizes past exam answers aces practice tests but fails a new exam — they learned the answers, not the subject.'),
  ('hash-tables', 'computer-science', 'Hash Tables',
   'A hash table maps keys to values in near-constant time by running the key through a hash function to pick a storage slot directly, instead of searching for it. Collisions — two keys landing in the same slot — are handled with techniques like chaining or open addressing.',
   'Dictionaries in Python, objects in JavaScript, and HashMaps in Java are all hash tables: looking up user["email"] takes the same time whether the table holds ten entries or ten million.'),
  ('linear-independence', 'mathematics', 'Linear Independence',
   'Vectors are linearly independent when none of them can be built as a combination of the others — each one adds a genuinely new direction. The number of independent directions in a space is its dimension, and this idea underpins how neural network embeddings, image compression, and recommendation systems represent information compactly.',
   'In 3D space, three vectors pointing along x, y, and z are independent. Add a fourth vector and it must be expressible from the first three — it adds no new direction.'),
  ('file-descriptors', 'linux-systems', 'File Descriptors',
   'On Linux, everything a process reads or writes — files, sockets, pipes, terminals — is accessed through a file descriptor: a small integer handle into a per-process table of open resources. This uniform interface is why the same read() and write() calls work on a file, a network connection, or your keyboard.',
   'Every process starts with descriptor 0 (stdin), 1 (stdout), and 2 (stderr). Redirecting output with "ls > out.txt" just makes descriptor 1 point at the file instead of the terminal.'),
  ('rest-apis', 'software-engineering', 'REST',
   'REST is an architectural style for APIs where the server exposes resources (users, orders, concepts) at URLs, and clients manipulate them with standard HTTP verbs: GET to read, POST to create, PUT/PATCH to update, DELETE to remove. Statelessness — each request carrying everything the server needs — is what lets REST APIs scale horizontally.',
   'GET /users/42 fetches user 42; DELETE /users/42 removes them. The verb carries the intent, the URL carries the target.'),
  ('attention-mechanism', 'artificial-intelligence', 'Attention',
   'Attention lets a model decide which parts of its input matter most for the current prediction, instead of compressing everything into one fixed summary. Each output position computes relevance scores against every input position and takes a weighted blend. It is the core operation of the transformer architecture behind modern large language models.',
   'Translating "the cat sat on the mat" to French, the model generating "chat" attends strongly to "cat" and weakly to the rest of the sentence.'),
  ('recursion', 'computer-science', 'Recursion',
   'Recursion solves a problem by reducing it to smaller instances of itself, with a base case that stops the reduction. It mirrors the structure of self-similar data — trees, nested lists, filesystems — which is why recursive code over such data is often shorter and clearer than the iterative version.',
   'Computing the size of a folder: the size of a folder is the sum of the sizes of its files plus the sizes of its subfolders — computed the same way.'),
  ('probability-distributions', 'mathematics', 'Probability Distributions',
   'A probability distribution describes which outcomes a random process can produce and how likely each one is. Choosing the right distribution — normal for accumulated small effects, Poisson for rare event counts, uniform for pure chance — is often the first modeling decision in statistics and machine learning.',
   'Human heights follow a normal distribution: most values cluster near the mean, extremes are rare. The number of requests hitting a server per second is closer to Poisson.'),
  ('ssh', 'linux-systems', 'SSH',
   'SSH (Secure Shell) gives you an encrypted channel to run commands on a remote machine. Authentication is best done with key pairs: your private key stays on your machine, the public key sits on the server, and a challenge–response proves your identity without any secret crossing the network.',
   '"ssh user@server" opens a remote shell; "scp file user@server:" copies a file over the same protocol; git push to GitHub over SSH uses the same key mechanism.'),
  ('database-indexes', 'software-engineering', 'Database Indexes',
   'An index is a sorted auxiliary structure (typically a B-tree) that lets a database find rows without scanning the whole table — turning O(n) scans into O(log n) lookups. The trade-off: every index slows down writes and consumes space, because it must be updated on each insert or update.',
   'A query filtering on email over a million users takes milliseconds with an index on email, and seconds without one. EXPLAIN shows which one the database chose.'),
  ('embeddings', 'artificial-intelligence', 'Embeddings',
   'An embedding represents a word, sentence, image, or user as a list of numbers — a point in high-dimensional space — arranged so that similar things sit near each other. Similarity search over embeddings powers semantic search, recommendations, and retrieval-augmented generation.',
   '"king" and "queen" land near each other in embedding space; a search for "how to fix a flat tire" retrieves a document titled "repairing bicycle punctures" despite sharing no keywords.'),
  ('deadlock', 'computer-science', 'Deadlock',
   'A deadlock occurs when two or more processes each hold a resource the other needs, and each waits forever for the other to release it. The classic prevention strategy is to acquire locks in a globally consistent order, so a circular wait can never form.',
   'Thread A locks the accounts table then wants the orders table; thread B locks orders then wants accounts. Both wait forever. Locking both in alphabetical order prevents it.'),
  ('expected-value', 'mathematics', 'Expected Value',
   'The expected value of a random quantity is its long-run average: each possible outcome weighted by its probability. It is the single number that summarizes whether a bet, an investment, or an algorithmic choice is favorable over many repetitions — even though no single trial may ever equal it.',
   'A lottery ticket costing $2 with a 1-in-10-million chance at $10 million has an expected value of $1 — you lose $1 per ticket on average, which is how lotteries stay in business.'),
  ('systemd-services', 'linux-systems', 'systemd Services',
   'systemd is the init system on most modern Linux distributions: the first process to start, responsible for launching and supervising everything else. A service is described declaratively in a unit file — what to run, when to restart it, what it depends on — and managed with systemctl.',
   '"systemctl status nginx" shows whether the web server is running and its recent logs; "systemctl enable nginx" makes it start on every boot; Restart=on-failure brings it back if it crashes.')
) as v (slug, topic_slug, title, summary, example)
join public.topics t on t.slug = v.topic_slug
on conflict (slug) do update
  set title    = excluded.title,
      summary  = excluded.summary,
      example  = excluded.example,
      topic_id = excluded.topic_id;

commit;
