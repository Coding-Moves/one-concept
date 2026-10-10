import { safeUrl } from "./api";
import type { Lesson } from "./types";
import { Field } from "./ui";
import { MarkdownText } from "./MarkdownText";
export function Value({ value }: { value: unknown }) {
  return (
    <pre className="plain-value">
      {typeof value === "string"
        ? value
        : (JSON.stringify(value, null, 2) ?? "Not provided")}
    </pre>
  );
}
export function LessonView({
  body,
  links,
}: {
  body: Lesson;
  links: { title: string; url: string }[];
}) {
  return (
    <div className="lesson-document">
      <section>
        <p className="eyebrow">01 · CONCEPT</p>
        <h2><MarkdownText value={body.title || "Untitled lesson"} inline /></h2>
        <MarkdownText value={body.summary} />
      </section>
      <section className="example">
        <h3>Worked example</h3>
        <MarkdownText value={body.example} />
      </section>
      <section>
        <p className="eyebrow">02 · CURRICULUM</p>
        <h3>Learning objective</h3>
        <MarkdownText value={body.curriculum?.objective} />
        <div className="metadata">
          <span>Difficulty {body.curriculum?.difficulty ?? "—"}</span>
          <span>Subtopic: {body.subtopic_slug}</span>
        </div>
        <h3>Prerequisites</h3>
        {body.curriculum.prerequisites.length ? (
          <ul>
            {body.curriculum.prerequisites.map((slug) => (
              <li key={slug}>{slug.replaceAll("-", " ")}</li>
            ))}
          </ul>
        ) : (
          <p>No prerequisites.</p>
        )}
        <h3>References</h3>
        <ul>
          {links
            .filter((link) => safeUrl(link.url))
            .map((link, i) => (
              <li key={i}>
                <a
                  href={safeUrl(link.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MarkdownText value={link.title} inline links={false} /> ↗
                </a>
              </li>
            ))}
        </ul>
      </section>
      <section>
        <p className="eyebrow">03 · RECALL</p>
        <h3>Flashcard</h3>
        <div className="flashcard">
          <span className="muted">FRONT</span>
          <MarkdownText value={body.learning_package?.flashcard?.front} />
          <span className="muted">BACK</span>
          <MarkdownText value={body.learning_package?.flashcard?.back} />
        </div>
      </section>
      <section>
        <p className="eyebrow">04 · PRACTICE</p>
        <h3>All questions & answers</h3>
        {Array.isArray(body.learning_package?.mcqs) ? (
          body.learning_package.mcqs.map((q, i) => (
            <article key={i} className="question">
              <h4>Question {i + 1}</h4>
              <MarkdownText value={q.question} />
              <ol type="A">
                {Array.isArray(q.options)
                  ? q.options.map((o, n) => (
                      <li
                        key={n}
                        className={
                          q.correct_index === n ? "correct-answer" : ""
                        }
                      >
                        <MarkdownText value={o} inline />
                        {q.correct_index === n && (
                          <strong> · Correct answer</strong>
                        )}
                      </li>
                    ))
                  : null}
              </ol>
              {q.explanation && (
                <>
                  <h4>Explanation</h4>
                  <MarkdownText value={q.explanation} />
                </>
              )}
            </article>
          ))
        ) : (
          <p>No valid question package available.</p>
        )}
      </section>
      {(body.model || body.prompt_version) && (
        <section className="muted">
          <h3>Generation record</h3>
          <p>
            Model: {body.model || "Unknown"} · Prompt version: {body.prompt_version || "Unknown"}
          </p>
        </section>
      )}
    </div>
  );
}
export function LessonEditor({
  body,
  onChange,
}: {
  body: Lesson;
  onChange: (b: Lesson) => void;
}) {
  const curriculum = body.curriculum || {
    objective: "",
    difficulty: 1,
    prerequisites: [],
    references: [],
  };
  const pack = body.learning_package || {
    flashcard: { front: "", back: "" },
    mcqs: [],
  };
  function text(key: "title" | "summary" | "example", title: string) {
    return (
      <Field title={title}>
        <textarea
          value={body[key] || ""}
          onChange={(e) => onChange({ ...body, [key]: e.target.value })}
        />
      </Field>
    );
  }
  return (
    <div className="editor">
      <p className="muted">Lesson writing supports Markdown: **bold**, *italic*, `code`, lists, links, and fenced code blocks. URLs, slugs, and settings stay plain text.</p>
      {text("title", "Title")}
      {text("summary", "Explanation")}
      {text("example", "Worked example")}
      <Field title="Learning objective">
        <textarea
          value={curriculum.objective}
          onChange={(e) =>
            onChange({
              ...body,
              curriculum: { ...curriculum, objective: e.target.value },
            })
          }
        />
      </Field>
      <Field title="Difficulty">
        <select
          value={curriculum.difficulty}
          onChange={(e) =>
            onChange({
              ...body,
              curriculum: { ...curriculum, difficulty: Number(e.target.value) },
            })
          }
        >
          <option value={1}>Foundations</option>
          <option value={2}>Intermediate</option>
          <option value={3}>Advanced</option>
        </select>
      </Field>
      <Field title="Prerequisite slugs (comma separated)">
        <input
          value={curriculum.prerequisites.join(", ")}
          onChange={(e) =>
            onChange({
              ...body,
              curriculum: {
                ...curriculum,
                prerequisites: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
            })
          }
        />
      </Field>
      <h3>References</h3>
      {curriculum.references.map((r, i) => (
        <div key={i} className="reference-editor">
          <Field title={`Reference ${i + 1} title`}>
            <input
              value={r.title}
              onChange={(e) =>
                onChange({
                  ...body,
                  curriculum: {
                    ...curriculum,
                    references: curriculum.references.map((x, j) =>
                      j === i ? { ...x, title: e.target.value } : x,
                    ),
                  },
                })
              }
            />
          </Field>
          <Field title={`Reference ${i + 1} URL`}>
            <input
              type="url"
              value={r.url}
              onChange={(e) =>
                onChange({
                  ...body,
                  curriculum: {
                    ...curriculum,
                    references: curriculum.references.map((x, j) =>
                      j === i ? { ...x, url: e.target.value } : x,
                    ),
                  },
                })
              }
            />
          </Field>
          <button
            onClick={() =>
              onChange({
                ...body,
                curriculum: {
                  ...curriculum,
                  references: curriculum.references.filter((_, j) => j !== i),
                },
              })
            }
          >
            Remove reference {i + 1}
          </button>
        </div>
      ))}
      <button
        disabled={curriculum.references.length >= 10}
        onClick={() =>
          onChange({
            ...body,
            curriculum: {
              ...curriculum,
              references: [...curriculum.references, { title: "", url: "" }],
            },
          })
        }
      >
        Add reference
      </button>
      <h3>Flashcard</h3>
      {(["front", "back"] as const).map((side) => (
        <Field key={side} title={`Flashcard ${side}`}>
          <textarea
            value={pack.flashcard[side]}
            onChange={(e) =>
              onChange({
                ...body,
                learning_package: {
                  ...pack,
                  flashcard: { ...pack.flashcard, [side]: e.target.value },
                },
              })
            }
          />
        </Field>
      ))}
      <h3>Three practice questions</h3>
      {Array.from({ length: 3 }, (_, i) => {
        const q = pack.mcqs[i] || {
          question: "",
          options: ["", "", "", ""],
          correct_index: 0,
        };
        function update(next: typeof q) {
          onChange({
            ...body,
            learning_package: {
              ...pack,
              mcqs: Array.from({ length: 3 }, (_, j) =>
                i === j
                  ? next
                  : pack.mcqs[j] || {
                      question: "",
                      options: ["", "", "", ""],
                      correct_index: 0,
                    },
              ),
            },
          });
        }
        return (
          <fieldset key={i}>
            <legend>Question {i + 1}</legend>
            <Field title="Question text">
              <textarea
                value={q.question}
                onChange={(e) => update({ ...q, question: e.target.value })}
              />
            </Field>
            {Array.from({ length: 4 }, (_, n) => (
              <Field key={n} title={`Option ${n + 1}`}>
                <input
                  value={q.options[n] || ""}
                  onChange={(e) =>
                    update({
                      ...q,
                      options: Array.from({ length: 4 }, (_, j) =>
                        j === n ? e.target.value : q.options[j] || "",
                      ),
                    })
                  }
                />
              </Field>
            ))}
            <Field title="Correct answer">
              <select
                value={q.correct_index}
                onChange={(e) =>
                  update({ ...q, correct_index: Number(e.target.value) })
                }
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    Option {n + 1}
                  </option>
                ))}
              </select>
            </Field>
          </fieldset>
        );
      })}
      <section className="editor-preview" aria-label="Lesson Markdown preview">
        <h3>Preview before saving</h3>
        <LessonView body={{ ...body, curriculum, learning_package: pack }} links={curriculum.references} />
      </section>
    </div>
  );
}
