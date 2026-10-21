/** One bounded provider call. SQL owns quota, claims, and private staging. */

export const PROMPT_VERSION = '2026-09-v3-quality';

export type LearningPackage = {
  flashcard: { front: string; back: string };
  mcqs: Array<{ question: string; options: string[]; correct_index: number }>;
};
export type GeneratedConcept = {
  summary: string;
  example: string;
  learning_package: LearningPackage;
};
export type GeminiConfig = { apiKey: string; model: string };

export class GeminiError extends Error {
  readonly code: 'provider_configuration' | 'rate_limited' | 'provider_error' | 'validation_failed';
  constructor(code: 'provider_configuration' | 'rate_limited' |
    'provider_error' | 'validation_failed') {
    super(code);
    this.code = code;
  }
}

const SYSTEM = `You write One Concept, a daily learning app. Each lesson is read in thirty seconds over morning coffee.

Voice: a sharp friend explaining something across the table. Not a textbook, not a blog post, not documentation.

Rules, in order of importance:
- 2 to 3 short sentences for the summary. Never more.
- Plain everyday words. If a simpler word exists, use it.
- Say the interesting thing directly. Cut every sentence that merely sounds informative.
- BANNED words and moves: "leverage", "robust", "crucial", "facilitates", "enables", "utilize", "furthermore", "in essence", "plays a vital role", "in the world of", any sentence that starts by restating the title.
- The example is ONE concrete moment a person can picture — a command they might type, a thing that happened, a comparison to daily life. One or two short sentences.
- No preamble, no sign-off, no hype, no emoji, no rhetorical questions.`;

const EXAMPLES = `Here are three lessons in the exact voice to match.

Title: Idempotency
Summary: An operation is idempotent when doing it twice leaves things exactly as if you did it once. That one property is what makes retries safe — if the network dies mid-request, the client can just try again without breaking anything.
Example: Pressing an elevator button five times doesn't call five elevators. Submitting an online order twice, though, buys two — which is why payment systems work hard to be idempotent.

Title: Overfitting
Summary: A model overfits when it memorizes its training data instead of learning the pattern behind it. It looks brilliant on data it has seen and falls apart on anything new.
Example: A student who memorizes last year's exam answers aces every practice test — then fails the real exam, because they learned the answers, not the subject.

Title: File Descriptors
Summary: On Linux, everything a program reads or writes — files, network connections, your keyboard — is handled through a file descriptor: a small number that stands for an open resource. One simple interface, so the same code can read from any of them.
Example: Every program starts with three: 0 is input, 1 is output, 2 is errors. Typing "ls > out.txt" just points number 1 at a file instead of your screen.`;

const RESPONSE_SCHEMA = {
  type: 'object', properties: {
    summary: { type: 'string' }, example: { type: 'string' },
    learning_package: { type: 'object', properties: {
      flashcard: { type: 'object', properties: { front: { type: 'string' },
        back: { type: 'string' } }, required: ['front', 'back'] },
      mcqs: { type: 'array', minItems: 3, maxItems: 3, items: {
        type: 'object', properties: { question: { type: 'string' },
          options: { type: 'array', minItems: 4, maxItems: 4,
            items: { type: 'string' } },
          correct_index: { type: 'integer', minimum: 0, maximum: 3 } },
        required: ['question', 'options', 'correct_index'],
      } },
    }, required: ['flashcard', 'mcqs'] },
  }, required: ['summary', 'example', 'learning_package'],
};

export function buildPrompt(title: string, topic: string, subtopic: string | null,
  angle: string | null): string {
  return `${SYSTEM}\n\n${EXAMPLES}\n\nNow write the concept below.\n\n` +
    `Topic area: ${topic}\nSubtopic: ${subtopic || 'Not specified'}\n` +
    `Title: ${title}${angle ? `\nAngle to take: ${angle}` : ''}\n\n` +
    'Also include learning_package: a non-repetitive flashcard and exactly three MCQs. Each MCQ needs four distinct options and correct_index 0-3. Return JSON matching the requested schema.';
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GeminiError('validation_failed');
  }
  return value as Record<string, unknown>;
}

function length(value: string): number { return Array.from(value).length; }
function words(value: string): string {
  return (value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).join(' ');
}
function optionKey(value: string): string {
  return (value.toLowerCase().match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []).join(' ');
}
function textInRange(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && length(value) >= min && length(value) <= max;
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

export function validateGenerated(value: unknown,
  bounds: { summaryMax: number; exampleMax: number } =
    { summaryMax: 420, exampleMax: 300 }): GeneratedConcept {
  const payload = object(value);
  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
  const example = typeof payload.example === 'string' ? payload.example.trim() : '';
  if (!textInRange(summary, 100, bounds.summaryMax) ||
      !textInRange(example, 40, bounds.exampleMax) ||
      summary === example || summary.includes('```') || example.includes('```')) {
    throw new GeminiError('validation_failed');
  }
  const lowered = summary.toLowerCase();
  if (['in this lesson', 'as an ai', 'i cannot', 'here is', 'sure,', 'certainly,']
    .some(prefix => lowered.startsWith(prefix)) ||
      ['leverage', 'crucial', 'furthermore', 'in the world of', 'plays a vital role',
        'in essence', 'facilitates'].some(phrase => lowered.includes(phrase))) {
    throw new GeminiError('validation_failed');
  }
  const packageValue = object(payload.learning_package);
  if (!onlyKeys(packageValue, ['flashcard', 'mcqs'])) throw new GeminiError('validation_failed');
  const flashcard = object(packageValue.flashcard);
  if (!onlyKeys(flashcard, ['front', 'back']) ||
      !textInRange(flashcard.front, 12, 280) || !textInRange(flashcard.back, 12, 500) ||
      words(flashcard.front) === words(flashcard.back)) throw new GeminiError('validation_failed');
  if (!Array.isArray(packageValue.mcqs) || packageValue.mcqs.length !== 3) {
    throw new GeminiError('validation_failed');
  }
  const mcqs = packageValue.mcqs.map(item => {
    const question = object(item);
    if (!onlyKeys(question, ['question', 'options', 'correct_index']) ||
        !textInRange(question.question, 12, 360) ||
        !Array.isArray(question.options) || question.options.length !== 4 ||
        question.options.some(option => !textInRange(option, 1, 240) || !option.trim()) ||
        !Number.isInteger(question.correct_index) ||
        Number(question.correct_index) < 0 || Number(question.correct_index) > 3) {
      throw new GeminiError('validation_failed');
    }
    const options = question.options as string[];
    if (new Set(options.map(optionKey)).size !== 4) throw new GeminiError('validation_failed');
    return { question: question.question as string, options,
      correct_index: question.correct_index as number };
  });
  if (new Set(mcqs.map(item => words(item.question))).size !== 3) {
    throw new GeminiError('validation_failed');
  }
  return { summary, example, learning_package: {
    flashcard: { front: flashcard.front, back: flashcard.back }, mcqs,
  } };
}

export async function generateConcept(fetcher: typeof fetch, config: GeminiConfig,
  input: { title: string; topic: string; subtopic: string | null; angle: string | null },
): Promise<GeneratedConcept> {
  if (!config.apiKey || !/^[a-zA-Z0-9._-]{1,120}$/.test(config.model)) {
    throw new GeminiError('provider_configuration');
  }
  let response: Response;
  try {
    response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json',
          'x-goog-api-key': config.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: buildPrompt(
          input.title, input.topic, input.subtopic, input.angle) }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 800,
          responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA } }),
        signal: AbortSignal.timeout(45000), redirect: 'error',
      });
  } catch { throw new GeminiError('provider_error'); }
  if (response.status === 429) throw new GeminiError('rate_limited');
  if (!response.ok) throw new GeminiError('provider_error');
  try {
    const raw = await response.text();
    if (raw.length > 100000) throw new Error('oversized provider response');
    const result = JSON.parse(raw) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || text.length > 50000) throw new Error('missing text');
    return validateGenerated(JSON.parse(text));
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    throw new GeminiError('validation_failed');
  }
}
