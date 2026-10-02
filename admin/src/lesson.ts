import type { Lesson } from "./types";
// Legacy packages can predate the flashcard/curriculum schema. Fill missing
// editor fields without inventing content; publication still requires API validation.
export function editableLesson(raw: unknown): Lesson {
  const object = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const b = object(raw),
    c = object(b.curriculum),
    p = object(b.learning_package),
    f = object(p.flashcard);
  return {
    title: text(b.title),
    summary: text(b.summary),
    example: text(b.example),
    subtopic_slug: text(b.subtopic_slug),
    model: typeof b.model === "string" ? b.model : null,
    prompt_version:
      typeof b.prompt_version === "string" ? b.prompt_version : null,
    curriculum: {
      objective: text(c.objective),
      difficulty: [1, 2, 3].includes(Number(c.difficulty))
        ? Number(c.difficulty)
        : 1,
      prerequisites: list(c.prerequisites).filter(
        (v): v is string => typeof v === "string",
      ),
      references: list(c.references).map((v) => {
        const r = object(v);
        return { title: text(r.title), url: text(r.url) };
      }),
    },
    learning_package: {
      flashcard: { front: text(f.front), back: text(f.back) },
      mcqs: Array.from({ length: 3 }, (_, i) => {
        const q = object(list(p.mcqs)[i]);
        return {
          question: text(q.question),
          options: Array.from({ length: 4 }, (_, n) =>
            text(list(q.options)[n]),
          ),
          correct_index: [0, 1, 2, 3].includes(Number(q.correct_index))
            ? Number(q.correct_index)
            : 0,
        };
      }),
    },
  };
}
