/**
 * Dev CLI: streams an answer to stdout, exercising the LLM provider layer
 * end-to-end without the web UI. Usage:
 *
 *   pnpm --filter server ask <resourceId> "<question>"
 */
import { getDb } from "../db.js";
import { getResourceById, getResourceTextSections } from "../library/store.js";
import { getProvider, LLMError } from "../llm/provider.js";
import { buildContext } from "../llm/context.js";

async function main() {
  const [resourceId, question] = process.argv.slice(2);
  if (!resourceId || !question) {
    console.error('Usage: pnpm --filter server ask <resourceId> "<question>"');
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const resource = getResourceById(db, resourceId);
  if (!resource) {
    console.error(`No resource found with id ${resourceId}`);
    process.exitCode = 1;
    return;
  }

  const provider = getProvider(db, "query", "thread", resourceId);
  if (!provider) {
    console.error("No LLM provider configured — set one in Settings first.");
    process.exitCode = 1;
    return;
  }

  const sections = getResourceTextSections(db, resourceId);
  const { instructions, bookContext } = buildContext({
    title: resource.title,
    author: resource.author,
    sections,
    highlight: { exact: "", prefix: "", suffix: "", spineIndex: 0 },
    contextTokens: provider.capabilities().contextTokens,
  });

  try {
    for await (const chunk of provider.stream({
      instructions,
      bookContext,
      messages: [{ role: "user", content: question }],
    })) {
      process.stdout.write(chunk.text);
    }
    process.stdout.write("\n");
  } catch (err) {
    if (err instanceof LLMError) {
      console.error(`\n[${err.code}] ${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  }
}

main();
