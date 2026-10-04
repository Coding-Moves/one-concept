import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeUrl } from "./api";

/** Lesson Markdown is untrusted content. React renders HTML as text and images are omitted. */
export function MarkdownText({ value, inline = false, links = true }: { value: unknown; inline?: boolean; links?: boolean }) {
  const source = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "Not provided");
  const content = inline ? source.replaceAll("\n", " ") : source;
  const rendered = <Markdown remarkPlugins={[remarkGfm]} components={{
      ...(inline ? { p: ({ children }: { children?: ReactNode }) => <span>{children}</span> } : {}),
      img: ({ alt }) => <span>{alt ?? "[image]"}</span>,
      a: ({ href, children }) => {
        const url = safeUrl(href ?? "");
        return url && links ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
      },
    }}>{content}</Markdown>;
  return inline ? <span className="lesson-markdown lesson-markdown-inline">{rendered}</span> : <div className="lesson-markdown">{rendered}</div>;
}
import type { ReactNode } from "react";
