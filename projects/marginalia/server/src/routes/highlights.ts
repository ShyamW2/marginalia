import { Router } from "express";
import { CreateHighlightBodySchema } from "@marginalia/shared";
import { getDb } from "../db.js";
import {
  createHighlight,
  deleteHighlight,
  getHighlightById,
} from "../annotations/highlights.js";
import { getResourceById } from "../library/store.js";

export const highlightsRouter: Router = Router();

highlightsRouter.post("/", (req, res) => {
  const parsed = CreateHighlightBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  const resource = getResourceById(getDb(), parsed.data.resourceId);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }

  const highlight = createHighlight(getDb(), parsed.data);
  res.status(201).json(highlight);
});

highlightsRouter.delete("/:id", (req, res) => {
  const highlight = getHighlightById(getDb(), req.params.id);
  if (!highlight) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  deleteHighlight(getDb(), req.params.id);
  res.status(204).end();
});
