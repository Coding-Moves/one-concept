import { expect, test } from "vitest";
import { editableLesson } from "./lesson";
test("partial legacy packages remain editable without inventing lesson text", () => {
  const lesson = editableLesson({
    title: "Existing lesson",
    curriculum: { objective: "Preserved objective" },
    learning_package: { mcqs: [null] },
  });
  expect(lesson.title).toBe("Existing lesson");
  expect(lesson.curriculum.objective).toBe("Preserved objective");
  expect(lesson.curriculum.references).toEqual([]);
  expect(lesson.learning_package.mcqs).toHaveLength(3);
  expect(lesson.learning_package.mcqs[0].options).toEqual(["", "", "", ""]);
  expect(lesson.summary).toBe("");
});
test("prompt version and complete lesson fields survive editing", () => {
  const lesson = editableLesson({
    model: "model",
    prompt_version: "v12",
    learning_package: {
      mcqs: [
        {
          question: "Question?",
          options: ["a", "b", "c", "d"],
          correct_index: 2,
        },
      ],
    },
  });
  expect(lesson.prompt_version).toBe("v12");
  expect(lesson.learning_package.mcqs[0].correct_index).toBe(2);
});
