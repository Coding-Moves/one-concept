/** Editorial preview formatting. Raw service-role rows never leave this module. */

type ObjectValue = Record<string, unknown>;

const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ObjectValue : null;

function pythonJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(',')}]`;
  const record = object(value);
  if (!record) throw new Error('Invalid editorial digest data');
  return `{${Object.keys(record).sort().map(key => `${pythonJson(key)}:${pythonJson(record[key])}`).join(',')}}`;
}

export async function editorialDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(pythonJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function sourceLinks(body: ObjectValue): Array<{ title: string; url: string }> {
  const curriculum = object(body.curriculum);
  const references = curriculum?.references;
  if (!Array.isArray(references)) return [];
  const links = [];
  for (const item of references.slice(0, 10)) {
    const ref = object(item);
    if (!ref || typeof ref.url !== 'string') continue;
    try {
      const parsed = new URL(ref.url);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && parsed.hostname && !parsed.username && !parsed.password) {
        links.push({ title: String(ref.title ?? 'Source').slice(0, 200),
          url: ref.url.slice(0, 2083) });
      }
    } catch { /* Legacy reference text is untrusted data. */ }
  }
  return links;
}

function bodyErrors(body: ObjectValue): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  const error = (field: string, message: string): void => { errors.push({ field, message }); };
  const string = (field: string, value: unknown, min: number, max: number): void => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      error(field, `Expected ${min}–${max} characters`);
    }
  };
  const slug = (field: string, value: unknown): void => {
    if (typeof value !== 'string' || value.length > 120
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) error(field, 'Invalid slug');
  };
  const only = (field: string, value: ObjectValue, keys: string[]): void => {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) error(`${field}${field ? '.' : ''}${key}`, 'Extra field');
    }
  };
  const normalized = (value: string): string =>
    (value.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).join(' ');
  string('title', body.title, 3, 160);
  string('summary', body.summary, 100, 600);
  string('example', body.example, 40, 500);
  slug('subtopic_slug', body.subtopic_slug);
  only('', body, ['title', 'summary', 'example', 'subtopic_slug', 'curriculum',
    'learning_package', 'model', 'prompt_version']);
  for (const key of ['model', 'prompt_version']) {
    if (body[key] !== null && body[key] !== undefined && typeof body[key] !== 'string') {
      error(key, 'Expected text or null');
    }
  }
  const curriculum = object(body.curriculum);
  if (!curriculum) error('curriculum', 'A curriculum is required');
  else {
    only('curriculum', curriculum, ['objective', 'difficulty', 'prerequisites', 'references']);
    string('curriculum.objective', curriculum.objective, 15, 500);
    if (typeof curriculum.difficulty !== 'number' || !Number.isInteger(curriculum.difficulty)
      || curriculum.difficulty < 1 || curriculum.difficulty > 3) {
      error('curriculum.difficulty', 'Choose difficulty 1–3');
    }
    if (curriculum.prerequisites !== undefined) {
      if (!Array.isArray(curriculum.prerequisites) || curriculum.prerequisites.length > 20) {
        error('curriculum.prerequisites', 'Choose at most 20 prerequisites');
      } else {
        for (const [index, value] of curriculum.prerequisites.entries()) {
          slug(`curriculum.prerequisites.${index}`, value);
        }
        if (new Set(curriculum.prerequisites).size !== curriculum.prerequisites.length) {
          error('curriculum.prerequisites', 'Duplicate prerequisites');
        }
      }
    }
    if (!Array.isArray(curriculum.references) || curriculum.references.length < 1
      || curriculum.references.length > 10) {
      error('curriculum.references', 'Add 1–10 references');
    } else {
      for (const [index, item] of curriculum.references.entries()) {
        const ref = object(item);
        if (!ref) { error(`curriculum.references.${index}`, 'Invalid reference'); continue; }
        only(`curriculum.references.${index}`, ref, ['title', 'url']);
        string(`curriculum.references.${index}.title`, ref.title, 3, 200);
        if (typeof ref.url !== 'string') {
          error(`curriculum.references.${index}.url`, 'Invalid URL');
        } else {
          try {
            const url = new URL(ref.url);
            if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw Error();
          } catch { error(`curriculum.references.${index}.url`, 'Invalid URL'); }
        }
      }
    }
  }
  const learning = object(body.learning_package);
  if (!learning) error('learning_package', 'A learning package is required');
  else only('learning_package', learning, ['flashcard', 'mcqs']);
  const flashcard = object(learning?.flashcard);
  if (!flashcard) error('learning_package.flashcard', 'A flashcard is required');
  else {
    only('learning_package.flashcard', flashcard, ['front', 'back']);
    string('learning_package.flashcard.front', flashcard.front, 12, 280);
    string('learning_package.flashcard.back', flashcard.back, 12, 500);
    if (typeof flashcard.front === 'string' && typeof flashcard.back === 'string'
      && normalized(flashcard.front) === normalized(flashcard.back)) {
      error('learning_package.flashcard', 'Flashcard back must not repeat its front');
    }
  }
  if (!Array.isArray(learning?.mcqs) || learning.mcqs.length !== 3) {
    error('learning_package.mcqs', 'Exactly three questions are required');
  } else {
    const questions: string[] = [];
    for (const [index, item] of learning.mcqs.entries()) {
      const mcq = object(item);
      if (!mcq) { error(`learning_package.mcqs.${index}`, 'Invalid question'); continue; }
      only(`learning_package.mcqs.${index}`, mcq, ['question', 'options', 'correct_index']);
      string(`learning_package.mcqs.${index}.question`, mcq.question, 12, 360);
      if (typeof mcq.question === 'string') questions.push(normalized(mcq.question));
      if (!Array.isArray(mcq.options) || mcq.options.length !== 4) {
        error(`learning_package.mcqs.${index}.options`, 'Exactly four options are required');
      } else {
        const options: string[] = [];
        for (const [optionIndex, value] of mcq.options.entries()) {
          string(`learning_package.mcqs.${index}.options.${optionIndex}`, value, 1, 240);
          if (typeof value === 'string') {
            options.push((value.toLocaleLowerCase().match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) ?? []).join(' '));
          }
        }
        if (new Set(options).size !== options.length) {
          error(`learning_package.mcqs.${index}.options`, 'MCQ options must be distinct');
        }
      }
      if (!Number.isInteger(mcq.correct_index) || Number(mcq.correct_index) < 0
        || Number(mcq.correct_index) > 3) {
        error(`learning_package.mcqs.${index}.correct_index`, 'Choose option 0–3');
      }
    }
    if (new Set(questions).size !== questions.length) {
      error('learning_package.mcqs', 'MCQ questions must be distinct');
    }
  }
  return errors;
}

export async function conceptPreview(raw: unknown): Promise<ObjectValue | null> {
  const source = object(raw);
  if (!source || typeof source.id !== 'string' || typeof source.slug !== 'string'
    || typeof source.status !== 'string' || typeof source.content_version !== 'number'
    || typeof source.subtopic_slug !== 'string' || typeof source.topic_active !== 'boolean'
    || typeof source.subtopic_active !== 'boolean' || !object(source.snapshot)) return null;
  const body: ObjectValue = {
    title: source.title, summary: source.summary, example: source.example,
    curriculum: source.curriculum, subtopic_slug: source.subtopic_slug,
    model: source.model, prompt_version: source.prompt_version,
    learning_package: { flashcard: source.flashcard, mcqs: source.mcqs },
  };
  const errors = bodyErrors(body);
  if (source.status === 'archived' || !source.topic_active || !source.subtopic_active) {
    errors.push({ field: 'publication', message: 'Content or taxonomy is retired' });
  } else if (body.subtopic_slug !== source.subtopic_slug) {
    errors.push({ field: 'publication', message: 'Subtopic does not match the concept' });
  } else if (typeof source.unknown_prerequisite === 'string') {
    errors.push({ field: 'publication', message:
      `Unknown prerequisite ${source.unknown_prerequisite}` });
  } else if (typeof source.unpublished_prerequisite === 'string') {
    errors.push({ field: 'publication', message:
      `Publish prerequisite ${source.unpublished_prerequisite} in an active topic and subtopic first` });
  } else if (typeof source.duplicate_slug === 'string') {
    errors.push({ field: 'publication', message:
      `Exact duplicate of ${source.duplicate_slug}; resolve overlap before publication` });
  }
  const token = await editorialDigest({ snapshot: source.snapshot,
    status: source.status, topic_active: source.topic_active,
    subtopic_active: source.subtopic_active, subtopic_slug: source.subtopic_slug });
  return {
    id: source.id, slug: source.slug, status: source.status, body,
    content_version: source.content_version, token,
    unchanged_legacy: source.legacy_snapshot !== null
      && pythonJson(source.legacy_snapshot) === pythonJson(source.snapshot),
    provenance: source.provenance,
    validation: { valid: errors.length === 0, errors,
      human_review_required: true, checklist_version: 1 },
    source_links: sourceLinks(body), text_format: 'markdown',
  };
}
