import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

function normalizeStandaloneMathBlocks(content: string): string {
  return content.replace(/(^|\n)[ \t]*\$\$([^\n]+?)\$\$[ \t]*(?=\n|$)/g, (_match, prefix: string, expression: string) => `${prefix}$$\n${expression.trim()}\n$$`);
}

export function AgentMessageContent({ content }: { readonly content: string }) {
  return <div className="agent-message-content"><Markdown skipHtml remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{normalizeStandaloneMathBlocks(content)}</Markdown></div>;
}
