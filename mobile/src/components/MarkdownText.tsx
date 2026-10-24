import { useMemo } from 'react';
import type { ReactNode } from 'react';
import MarkdownIt from 'markdown-it';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import type { Token as CodeToken } from 'prismjs';
import { useTheme } from '../context/ThemeContext';
import { scaleFont } from '../theme';
import { codeTokens } from './markdownCode';

type MdNode = { type: string; tag: string; content: string; info: string; attrs: [string, string | number][] | null; children: MdNode[] };
type MdToken = { type: string; tag: string; nesting: number; content: string; info?: string; attrs: [string, string | number][] | null; children: MdToken[] | null };
const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
// Parse link labels even when their destination is unsafe; the renderer below
// then presents only the label instead of leaking Markdown punctuation.
parser.validateLink = () => true;

function tree(tokens: readonly MdToken[]): MdNode[] {
  const root: MdNode = { type: 'root', tag: '', content: '', info: '', attrs: null, children: [] };
  const stack = [root];
  for (const token of tokens) {
    if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue; }
    const node: MdNode = { type: token.type, tag: token.tag, content: token.content, info: token.info ?? '', attrs: token.attrs, children: token.children ? tree(token.children) : [] };
    stack[stack.length - 1].children.push(node);
    if (token.nesting === 1) stack.push(node);
  }
  return root.children;
}

function safeLink(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Spoken labels should contain the readable answer, not Markdown punctuation. */
export function markdownPlainText(value: string) {
  const tokens = parser.parseInline(value || '', {});
  function readable(items: MdToken[]): string {
    return items.map(token => token.children ? readable(token.children) : token.type === 'softbreak' || token.type === 'hardbreak' ? ' ' : token.content).join('');
  }
  return readable(tokens);
}

/** Native Text renderer for lesson Markdown; HTML and remote Markdown images never render. */
export function MarkdownText({ value, style, inline = false, interactiveLinks = true }: { value: unknown; style?: StyleProp<TextStyle>; inline?: boolean; interactiveLinks?: boolean }) {
  const { colors } = useTheme();
  const source = typeof value === 'string' ? value : '';
  const nodes = useMemo(() => tree(inline ? parser.parseInline(source, {}) : parser.parse(source, {})), [source, inline]);
  const base = { color: colors.text, fontSize: scaleFont(15), lineHeight: scaleFont(23) };
  const code = { fontFamily: 'monospace', backgroundColor: colors.surfaceSubtle, color: colors.text } as const;

  function renderCode(items: (string | CodeToken)[], prefix = ''): ReactNode[] {
    return items.map((item, index) => {
      if (typeof item === 'string') return item;
      const tone = item.type === 'comment' || item.type === 'prolog' ? colors.textMuted
        : item.type === 'keyword' || item.type === 'boolean' ? colors.primary
        : item.type === 'string' || item.type === 'number' ? colors.success
        : colors.text;
      const content = typeof item.content === 'string' ? item.content : renderCode(Array.isArray(item.content) ? item.content : [item.content], `${prefix}${index}-`);
      return <Text key={`${prefix}${index}`} style={{ color: tone }}>{content}</Text>;
    });
  }

  function renderInline(items: MdNode[]): ReactNode[] {
    return items.map((node, index) => {
      const key = `${node.type}-${index}`;
      switch (node.type) {
        case 'text': return node.content;
        case 'code_inline': return <Text key={key} style={code}>{node.content}</Text>;
        case 'softbreak': return ' ';
        case 'hardbreak': return '\n';
        case 'strong_open': return <Text key={key} style={{ fontWeight: '700' }}>{renderInline(node.children)}</Text>;
        case 'em_open': return <Text key={key} style={{ fontStyle: 'italic' }}>{renderInline(node.children)}</Text>;
        case 's_open': return <Text key={key} style={{ textDecorationLine: 'line-through' }}>{renderInline(node.children)}</Text>;
        case 'link_open': {
          const url = safeLink(String(node.attrs?.find(([name]) => name === 'href')?.[1] ?? ''));
          return <Text key={key} style={url ? { color: colors.primary, textDecorationLine: 'underline' } : undefined} onPress={url && interactiveLinks ? () => { void Linking.openURL(url); } : undefined}>{renderInline(node.children)}</Text>;
        }
        case 'image': return node.content || node.children.map(child => child.content).join('');
        case 'html_inline': return node.content;
        default: return node.children.length ? renderInline(node.children) : node.content;
      }
    });
  }

  function renderBlock(items: MdNode[]): ReactNode[] {
    return items.map((node, index) => {
      const key = `${node.type}-${index}`;
      switch (node.type) {
        case 'paragraph_open': return <Text key={key} style={[base, style, { marginBottom: 8 }]}>{renderInline(node.children.flatMap(child => child.type === 'inline' ? child.children : [child]))}</Text>;
        case 'heading_open': {
          const level = Number(node.tag.match(/^h([1-6])$/)?.[1] ?? 2);
          const fontSize = level <= 2 ? 21 : level <= 4 ? 18 : 16;
          return <Text key={key} style={[base, style, { fontWeight: '700', fontSize: scaleFont(fontSize), lineHeight: scaleFont(fontSize + 8), marginTop: 4, marginBottom: 10 }]}>{renderInline(node.children.flatMap(child => child.type === 'inline' ? child.children : [child]))}</Text>;
        }
        case 'fence': case 'code_block': return <ScrollView key={key} horizontal showsHorizontalScrollIndicator style={{ backgroundColor: colors.surfaceSubtle, borderRadius: 8, marginBottom: 12 }} contentContainerStyle={{ padding: 12 }}><Text selectable style={[base, code, { fontSize: scaleFont(13), lineHeight: scaleFont(19) }]}>{renderCode(codeTokens(node.content, node.info))}</Text></ScrollView>;
        case 'blockquote_open': return <View key={key} style={{ borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 12, marginBottom: 8 }}>{renderBlock(node.children)}</View>;
        case 'bullet_list_open': case 'ordered_list_open': {
          const start = Number(node.attrs?.find(([name]) => name === 'start')?.[1] ?? 1);
          return <View key={key} style={{ marginBottom: 8 }}>{node.children.map((item, itemIndex) => <View key={itemIndex} style={{ flexDirection: 'row', alignItems: 'flex-start' }}><Text style={[base, { width: 28 }]}>{node.type === 'ordered_list_open' ? `${start + itemIndex}.` : '•'}</Text><View style={{ flex: 1 }}>{renderBlock(item.children)}</View></View>)}</View>;
        }
        case 'table_open': return <View key={key} style={{ marginBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: colors.textMuted }}>{renderBlock(node.children)}</View>;
        case 'tr_open': return <View key={key} style={{ flexDirection: 'row' }}>{renderBlock(node.children)}</View>;
        case 'th_open': case 'td_open': return <View key={key} style={{ flex: 1, padding: 6, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.textMuted }}><Text style={[base, style, node.type === 'th_open' && { fontWeight: '700' }]}>{renderInline(node.children.flatMap(child => child.type === 'inline' ? child.children : [child]))}</Text></View>;
        case 'inline': return <Text key={key} style={[base, style]}>{renderInline(node.children)}</Text>;
        case 'hr': return <View key={key} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.textMuted, marginVertical: 8 }} />;
        default: return node.children.length ? <View key={key}>{renderBlock(node.children)}</View> : null;
      }
    });
  }

  return inline ? <Text style={[base, style]}>{renderInline(nodes.flatMap(node => node.type === 'inline' ? node.children : [node]))}</Text> : <View>{renderBlock(nodes)}</View>;
}
