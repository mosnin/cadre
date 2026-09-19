"use client";
// beui.dev/components/agents/code-block

import { Check, Copy } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type AgentCodeLanguage, AgentCodeLine, useAgentCodeTokens } from "./agent-code";
import { SPRING_PRESS } from "./support/ease";
import { cn } from "./support/utils";

export type CodeBlockStatus = "streaming" | "complete";

export interface CodeBlockProps {
  code: string;
  language?: AgentCodeLanguage;
  filename?: ReactNode;
  status?: CodeBlockStatus;
  showLineNumbers?: boolean;
  highlightLines?: number[];
  maxHeight?: number;
  wrap?: boolean;
  copyable?: boolean;
  onCopy?: () => void | Promise<void>;
  className?: string;
}

export function CodeBlock({
  code,
  language = "text",
  filename,
  status = "complete",
  showLineNumbers = true,
  highlightLines = [],
  maxHeight,
  wrap = false,
  copyable = true,
  onCopy,
  className,
}: CodeBlockProps) {
  const reduce = useReducedMotion() ?? false;
  const viewportRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const streaming = status === "streaming";
  const tokens = useAgentCodeTokens(code, language);
  const highlighted = useMemo(() => new Set(highlightLines), [highlightLines]);
  let offset = 0;
  const lines = code.split("\n").map((content) => {
    const line = { content, offset };
    offset += content.length + 1;
    return line;
  });

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !streaming) return;

    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  const handleCopy = useCallback(async () => {
    try {
      if (onCopy) await onCopy();
      else if (navigator.clipboard) await navigator.clipboard.writeText(code);
      else return;
    } catch {
      return;
    }

    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [code, onCopy]);

  return (
    <div
      data-slot="code-block"
      data-state={status}
      aria-busy={streaming}
      className={cn(
        "rk-chat-markdown-pre-wrap w-full overflow-hidden rounded-2xl bg-muted/80 text-sm",
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-2.5 px-3">
        {filename ? (
          <span className="min-w-0 truncate font-mono text-xs text-foreground/80">{filename}</span>
        ) : null}
        <span className="text-xs font-medium text-muted-foreground/55">{language}</span>
        {copyable || onCopy ? (
          <motion.button
            type="button"
            aria-label={copied ? "Copied" : "Copy code"}
            title={copied ? "Copied" : "Copy code"}
            onClick={handleCopy}
            whileTap={undefined}
            transition={SPRING_PRESS}
            className="rk-chat-markdown-copy ml-auto grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? <Check className="size-[18px]" /> : <Copy className="size-[18px]" />}
          </motion.button>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        role={streaming ? "log" : undefined}
        aria-live={streaming ? "polite" : undefined}
        className={cn(
          "border-t border-foreground/[0.06] py-2",
          maxHeight ? "scrollbar-hide overflow-auto" : "overflow-visible",
        )}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <pre
          className={cn(
            "m-0 font-mono text-sm leading-6 text-foreground/85",
            wrap ? "min-w-0" : "min-w-max",
          )}
        >
          <code>
            {lines.map((line, index) => {
              const lineNumber = index + 1;
              return (
                <span
                  key={line.offset}
                  className={cn(
                    "grid min-h-6",
                    showLineNumbers ? "grid-cols-[2.75rem_minmax(0,1fr)]" : "grid-cols-1",
                    highlighted.has(lineNumber) && "bg-primary/10",
                  )}
                >
                  {showLineNumbers ? (
                    <span className="select-none pr-3 text-right tabular-nums text-muted-foreground/35">
                      {lineNumber}
                    </span>
                  ) : null}
                  <AgentCodeLine
                    code={line.content}
                    tokens={tokens?.[index]}
                    className={cn(
                      "pr-4",
                      showLineNumbers ? "pl-1" : "pl-4",
                      wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                    )}
                  />
                  {index < lines.length - 1 ? "\n" : null}
                </span>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}
