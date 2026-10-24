import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';

const aliases: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', javascript: 'javascript',
  ts: 'typescript', tsx: 'typescript', typescript: 'typescript',
  json: 'json', py: 'python', python: 'python',
  sh: 'bash', shell: 'bash', bash: 'bash',
  sql: 'sql', css: 'css', html: 'markup', xml: 'markup',
};

export function codeTokens(source: string, info: string) {
  const language = aliases[info.trim().split(/\s+/)[0].toLowerCase()];
  const grammar = language && Prism.languages[language];
  // Very large generated lessons should remain readable without expensive tokenization.
  return grammar && source.length <= 20_000 ? Prism.tokenize(source, grammar) : [source];
}
