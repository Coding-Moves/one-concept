import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./MarkdownText";
import { LessonView } from "./LessonView";
import { editableLesson } from "./lesson";

describe("lesson Markdown", () => {
  it("renders readable blocks and syntax-highlighted fenced code", () => {
    const html = renderToStaticMarkup(<MarkdownText value={"# Heading\n\nA **bold** paragraph.\n\n- one\n- two\n\n> note\n\n```js\nconst count = 2;\n```"} />);
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<pre><code class=\"language-js\">");
    expect(html).toContain("md-token-keyword");
    expect(html).toContain("const");
  });

  it("keeps unknown code languages readable and does not execute unsafe content", () => {
    const html = renderToStaticMarkup(<MarkdownText value={"```unknown\n<script>alert(1)</script>\n```\n\n[click](javascript:alert(1))\n\n<img src=x onerror=alert(1)>"} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("href=\"javascript:");
    expect(html).not.toContain("[click](javascript:");
    expect(html).not.toContain("<img");
  });

  it("accepts empty legacy content", () => {
    expect(renderToStaticMarkup(<MarkdownText value={null} />)).toContain("lesson-markdown");
  });

  it("keeps adjacent JSON, unknown code, Unicode, and malformed fences readable", () => {
    const source = "Plain text with `first` and `second`.\n\n```json\n{\"name\":\"世界\",\"items\":[1,{\"ok\":true}]}\n```\n```odd-language\nraw <tag>\n```\n```\nunclosed";
    const html = renderToStaticMarkup(<MarkdownText value={source} />);
    expect(html).toContain("<code>first</code>");
    expect(html).toContain("<code>second</code>");
    expect(html).toContain("md-token-property");
    expect(html).toContain("世界");
    expect(html).toContain("raw &lt;tag&gt;");
    expect(html).toContain("unclosed");
  });

  it("uses the same renderer in the reviewer and owner lesson view", () => {
    const body = editableLesson({ title: "## Structured Logging", summary: "A **machine-readable** record.", example: "```json\n{\"user_id\":123}\n```" });
    const html = renderToStaticMarkup(<LessonView body={body} links={[]} />);
    expect(html).toContain("Structured Logging");
    expect(html).not.toContain("## Structured Logging");
    expect(html).toContain("<strong>machine-readable</strong>");
    expect(html).toContain("md-token-property");
  });
});
