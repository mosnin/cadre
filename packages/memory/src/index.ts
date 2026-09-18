import type {
  AdapterContext,
  MemoryCommitRequest,
  MemoryExportRequest,
  MemoryReadRequest,
  MemoryRevision,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySnapshot,
  MemoryStore,
  PortableFile,
} from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";

export class MarkdownMemoryStore implements MemoryStore {
  constructor(private readonly prisma: PrismaClient) {}

  describe() {
    return {
      id: "markdown",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { search: true, revisions: true, markdownPortable: true },
    };
  }

  async read(request: MemoryReadRequest, context: AdapterContext): Promise<MemorySnapshot> {
    const documents = await this.prisma.memoryDocument.findMany({
      where: {
        spaceId: context.spaceId,
        userId: context.userId,
        scope: request.scope,
        ...(request.botId ? { botId: request.botId } : {}),
        ...(request.path ? { path: request.path } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    });
    return {
      documents: documents.map((doc) => ({
        id: doc.id,
        path: doc.path,
        content: doc.content,
        revision: doc.revision,
        updatedAt: doc.updatedAt.toISOString(),
      })),
    };
  }

  async search(
    request: MemorySearchRequest,
    context: AdapterContext,
  ): Promise<MemorySearchResult[]> {
    const documents = await this.prisma.memoryDocument.findMany({
      where: {
        spaceId: context.spaceId,
        userId: context.userId,
        ...(request.scope === "all" ? {} : { scope: request.scope }),
        ...(request.botId ? { botId: request.botId } : {}),
      },
    });
    const q = request.query.toLowerCase();
    // A score every hit shares is not a score. Rank by how often the query appears and
    // whether the path itself matches, so the field means something to whoever reads it.
    return documents
      .map((doc) => ({ doc, score: lexicalScore(doc.path, doc.content, q) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) => right.score - left.score || left.doc.path.localeCompare(right.doc.path),
      )
      .map((entry) => ({
        path: entry.doc.path,
        snippet: snippet(entry.doc.content, q),
        score: entry.score,
      }));
  }

  async commit(request: MemoryCommitRequest, context: AdapterContext): Promise<MemoryRevision> {
    const existing = await this.prisma.memoryDocument.findFirst({
      where: {
        spaceId: context.spaceId,
        userId: context.userId,
        scope: request.scope,
        botId: request.botId ?? null,
        path: request.path,
      },
    });
    const doc = existing
      ? await this.prisma.memoryDocument.update({
          where: { id: existing.id },
          data: { content: request.content, revision: existing.revision + 1 },
        })
      : await this.prisma.memoryDocument.create({
          data: {
            spaceId: context.spaceId,
            userId: context.userId,
            botId: request.botId,
            scope: request.scope,
            path: request.path,
            content: request.content,
          },
        });
    await this.prisma.memoryRevision.create({
      data: {
        documentId: doc.id,
        revision: doc.revision,
        content: request.content,
        sourceRunId: request.sourceRunId,
        sourceThreadId: request.sourceThreadId,
      },
    });
    return { id: doc.id, path: doc.path, revision: doc.revision, content: doc.content };
  }

  async *exportMarkdown(
    request: MemoryExportRequest,
    context: AdapterContext,
  ): AsyncIterable<PortableFile> {
    const snapshot = await this.read(
      { scope: request.scope === "all" ? "user" : request.scope, botId: request.botId },
      context,
    );
    for (const doc of snapshot.documents) {
      yield { path: doc.path, content: new TextEncoder().encode(doc.content) };
    }
  }

  async importMarkdown(
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ): Promise<MemoryRevision> {
    let last: MemoryRevision | undefined;
    for await (const file of files) {
      last = await this.commit(
        {
          scope: "user",
          path: file.path,
          content: new TextDecoder().decode(file.content),
        },
        context,
      );
    }
    if (!last) throw new Error("No memory files to import");
    return last;
  }
}

function snippet(content: string, q: string): string {
  const idx = content.toLowerCase().indexOf(q);
  if (idx < 0) return content.slice(0, 140);
  return content.slice(Math.max(0, idx - 40), idx + q.length + 80);
}

/**
 * How well a document answers a substring query, from zero (not at all) to one.
 *
 * Deliberately simple: this store is Markdown files in Postgres, and anything cleverer
 * belongs in a memory provider built for retrieval rather than here.
 */
function lexicalScore(path: string, content: string, query: string): number {
  if (!query) return 0;
  const haystack = content.toLowerCase();
  let occurrences = 0;
  for (let at = haystack.indexOf(query); at >= 0; at = haystack.indexOf(query, at + query.length))
    occurrences += 1;
  const inPath = path.toLowerCase().includes(query);
  if (occurrences === 0 && !inPath) return 0;
  // A name that matches is a stronger signal than a passing mention in a long document.
  const density = occurrences === 0 ? 0 : Math.min(1, occurrences / 5);
  return Math.min(1, (inPath ? 0.5 : 0) + density * 0.5) || 0.1;
}
