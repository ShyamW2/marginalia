import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderMarkdown } from "./markdown.js";

function html(source: string): string {
  const { container } = render(<div>{renderMarkdown(source)}</div>);
  return container.innerHTML;
}

describe("renderMarkdown", () => {
  it("renders a plain paragraph", () => {
    expect(html("Hello world")).toBe("<div><p>Hello world</p></div>");
  });

  it("renders bold, italic, and inline code", () => {
    const out = html("**bold** and *italic* and `code`");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<code>code</code>");
  });

  it("never injects raw HTML from the source text", () => {
    const out = html("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders fenced code blocks", () => {
    const out = html("```\nconst x = 1;\n```");
    expect(out).toContain("<pre><code>const x = 1;</code></pre>");
  });

  it("renders unordered lists", () => {
    const out = html("- one\n- two");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<li>two</li>");
  });

  it("renders ordered lists", () => {
    const out = html("1. first\n2. second");
    expect(out).toContain("<ol>");
    expect(out).toContain("<li>first</li>");
  });

  it("renders block quotes", () => {
    const out = html("> a quote\n> across lines");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("a quote");
  });

  it("separates paragraphs on blank lines", () => {
    const out = html("first paragraph\n\nsecond paragraph");
    expect(out).toBe("<div><p>first paragraph</p><p>second paragraph</p></div>");
  });
});
