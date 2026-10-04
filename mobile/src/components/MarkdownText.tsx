import { useMemo } from 'react';
import type { ReactNode } from 'react';
import MarkdownIt from 'markdown-it';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { scaleFont } from '../theme';

type MdNode = { type: string; content: string; attrs: [string, string | number][] | null; children: MdNode[] };
type MdToken = { type: string; nesting: number; content: string; attrs: [string, string | number][] | null; children: MdToken[] | null };
const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });

function tree(tokens: readonly MdToken[]): MdNode[] {
  const root: MdNode = { type: 'root', content: '', attrs: null, children: [] };
  const stack = [root];
  for (const token of tokens) {
    if (token.nesting === -1) { if (stack.length > 1) stack.pop(); continue; }
    const node: MdNode = { type: token.type, content: token.content, attrs: token.attrs, children: token.children ? tree(token.children) : [] };
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

/** Native Text renderer for lesson Markdown; HTML and remote Markdown images never render. */
export function MarkdownText({ value, style, inline = false, interactiveLinks = true }: { value: string; style?: StyleProp<TextStyle>; inline?: boolean; interactiveLinks?: boolean }) {
  const { colors } = useTheme();
  const nodes = useMemo(() => tree(inline ? parser.parseInline(value || '', {}) : parser.parse(value || '', {})), [value, inline]);
  const base = { color: colors.text, fontSize: scaleFont(15), lineHeight: scaleFont(23) };
  const code = { fontFamily: 'monospace', backgroundColor: colors.surfaceSubtle, color: colors.text } as const;

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
          return <Text key={key} style={{ color: colors.primary, textDecorationLine: 'underline' }} onPress={url && interactiveLinks ? () => { void Linking.openURL(url); } : undefined}>{renderInline(node.children)}</Text>;
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
        case 'heading_open': return <Text key={key} style={[base, style, { fontWeight: '700', fontSize: scaleFont(18), lineHeight: scaleFont(25), marginBottom: 8 }]}>{renderInline(node.children.flatMap(child => child.type === 'inline' ? child.children : [child]))}</Text>;
        case 'fence': case 'code_block': return <Text key={key} selectable style={[base, code, { padding: 12, borderRadius: 8, marginBottom: 8 }]}>{node.content}</Text>;
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
