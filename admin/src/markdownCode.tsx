import type { ReactNode } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup";

const aliases: Record<string, string> = {
  js: "javascript", jsx: "javascript", javascript: "javascript",
  ts: "typescript", tsx: "typescript", typescript: "typescript",
  json: "json", py: "python", python: "python",
  sh: "bash", shell: "bash", bash: "bash",
  sql: "sql", css: "css", html: "markup", xml: "markup",
};

export function highlightedCode(source: string, className?: string): ReactNode {
  const language = aliases[className?.match(/(?:^|\s)language-([\w-]+)/)?.[1].toLowerCase() ?? ""];
  const grammar = language && Prism.languages[language];
  if (!grammar || source.length > 20_000) return source;

  function render(items: (string | Prism.Token)[], prefix = ""): ReactNode[] {
    return items.map((item, index) => {
      if (typeof item === "string") return item;
      const content = typeof item.content === "string" ? item.content : render(Array.isArray(item.content) ? item.content : [item.content], `${prefix}${index}-`);
      return <span key={`${prefix}${index}`} className={`md-token md-token-${item.type}`}>{content}</span>;
    });
  }
  return render(Prism.tokenize(source, grammar));
}
