import { Router } from "express";
import { z } from "zod";
import { getDocumentForRead } from "../services/document.service.js";
import { requireAuth } from "../middleware/authenticate.js";
import { notFound } from "../errors.js";

export const documentRouter = Router();

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** RFC 6266 Content-Disposition for attachment downloads. */
function contentDispositionFor(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*/]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * GET /api/documents/:id - authenticated download.
 * Institution isolation is enforced inside the service; documents outside the
 * acting user's scope return the same 404 as missing ones.
 */
documentRouter.get("/:id", async (req, res, next) => {
  try {
    const { user } = requireAuth(req);
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      throw notFound("The requested document does not exist.");
    }

    const document = await getDocumentForRead(user, parsed.data.id);

    res.setHeader("Content-Type", document.mimeType);
    res.setHeader("Content-Length", String(document.content.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", contentDispositionFor(document.fileName));
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(document.content);
  } catch (error) {
    next(error);
  }
});
