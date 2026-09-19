import { CodeBlock as DirectoryCodeBlock } from "@cadre/ui-web/directory/code-block";
import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.web.css";
import { type ChatMarkdownProps, closeUnterminatedFence, sanitizeMarkdownUrl } from "./markdown";

function CodeBlock(props: React.ComponentPropsWithoutRef<"pre">) {
  const child = Children.toArray(props.children).find(isValidElement);
  const code = isValidElement<{ children?: ReactNode; className?: string }>(child)
    ? String(child.props.children ?? "")
    : String(props.children ?? "");
  const language = isValidElement<{ className?: string }>(child)
    ? child.props.className?.replace(/^language-/, "")
    : undefined;
  return (
    <DirectoryCodeBlock code={code} language={language ?? "text"} showLineNumbers={false} wrap />
  );
}

const components: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noreferrer noopener" />;
  },
  img({ node: _node, ...props }) {
    return <img {...props} alt={props.alt ?? ""} loading="lazy" />;
  },
  pre({ node: _node, ...props }) {
    return <CodeBlock {...props} />;
  },
};

export const ChatMarkdown = memo(function ChatMarkdown({
  children,
  streaming = false,
}: ChatMarkdownProps) {
  const source = streaming ? closeUnterminatedFence(children) : children;

  return (
    <div className={streaming ? "rk-chat-markdown rk-chat-markdown-streaming" : "rk-chat-markdown"}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => sanitizeMarkdownUrl(url, true) ?? ""}
      >
        {source}
      </ReactMarkdown>
      {streaming ? <span aria-hidden="true" className="rk-chat-markdown-cursor" /> : null}
    </div>
  );
});

export type { ChatMarkdownProps } from "./markdown";
