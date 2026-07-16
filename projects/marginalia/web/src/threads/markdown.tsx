import { Fragment, type ReactNode } from "react";

/**
 * Minimal markdown-to-React renderer for streamed LLM answers: paragraphs,
 * bold/italic/inline code, fenced code blocks, block quotes, and lists.
 * Deliberately builds React elements directly (never
 * dangerouslySetInnerHTML) so streamed model text can never inject HTML —
 * a small hand-rolled subset beats pulling in a markdown + sanitizer
 * dependency pair for what a reading companion's answers actually use.
 */

let keySeed = 0;
function nextKey(): string {
  keySeed += 1;
  return `md-${keySeed}`;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      nodes.push(<code key={nextKey()}>{match[1]}</code>);
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={nextKey()}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<em key={nextKey()}>{match[3]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderInlineLines(lines: string[]): ReactNode {
  return lines.map((line, idx) => (
    <Fragment key={idx}>
      {idx > 0 && <br />}
      {renderInline(line)}
    </Fragment>
  ));
}

export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    blocks.push(<p key={nextKey()}>{renderInlineLines(paragraphBuffer)}</p>);
    paragraphBuffer = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      flushParagraph();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or end of input)
      blocks.push(
        <pre key={nextKey()}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      blocks.push(<p key={nextKey()}><strong>{renderInline(headingMatch[1])}</strong></p>);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(<blockquote key={nextKey()}>{renderInlineLines(quoteLines)}</blockquote>);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={nextKey()}>
          {items.map((item) => (
            <li key={nextKey()}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={nextKey()}>
          {items.map((item) => (
            <li key={nextKey()}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    paragraphBuffer.push(line);
    i++;
  }
  flushParagraph();

  return <>{blocks}</>;
}
