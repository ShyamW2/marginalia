import { Router } from "express";
import {
  CreateHighlightBodySchema,
  HighlightTagsSchema,
  UpdateHighlightImportanceBodySchema,
  UpdateHighlightNoteBodySchema,
  UpdateHighlightPanelOffsetBodySchema,
  UpdateHighlightPanelSizeBodySchema,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import {
  createHighlight,
  deleteHighlight,
  getHighlightById,
  setHighlightImportance,
  setHighlightNote,
  setHighlightPanelOffset,
  setHighlightPanelSize,
} from "../annotations/highlights.js";
import { listTagsForHighlight, setTagsForHighlight } from "../annotations/tags.js";
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

highlightsRouter.put("/:id/importance", (req, res) => {
  const highlight = getHighlightById(getDb(), req.params.id);
  if (!highlight) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = UpdateHighlightImportanceBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setHighlightImportance(getDb(), req.params.id, parsed.data.importance);
  res.json({ ...highlight, importance: parsed.data.importance });
});

highlightsRouter.put("/:id/note", (req, res) => {
  const highlight = getHighlightById(getDb(), req.params.id);
  if (!highlight) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = UpdateHighlightNoteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setHighlightNote(getDb(), req.params.id, parsed.data.note);
  res.json({ ...highlight, note: parsed.data.note });
});

highlightsRouter.put("/:id/panel-offset", (req, res) => {
  const highlight = getHighlightById(getDb(), req.params.id);
  if (!highlight) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = UpdateHighlightPanelOffsetBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setHighlightPanelOffset(getDb(), req.params.id, parsed.data.panelDx, parsed.data.panelDy);
  res.json({ ...highlight, panelDx: parsed.data.panelDx, panelDy: parsed.data.panelDy });
});

highlightsRouter.put("/:id/panel-size", (req, res) => {
  const highlight = getHighlightById(getDb(), req.params.id);
  if (!highlight) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = UpdateHighlightPanelSizeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setHighlightPanelSize(getDb(), req.params.id, parsed.data.panelWidth, parsed.data.panelHeight);
  res.json({ ...highlight, panelWidth: parsed.data.panelWidth, panelHeight: parsed.data.panelHeight });
});

highlightsRouter.get("/:id/tags", (req, res) => {
  const highlight = getHighlightById(getDb(), req.params.id);
  if (!highlight) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ tags: listTagsForHighlight(getDb(), req.params.id) });
});

highlightsRouter.put("/:id/tags", (req, res) => {
  const highlight = getHighlightById(getDb(), req.params.id);
  if (!highlight) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = HighlightTagsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setTagsForHighlight(getDb(), req.params.id, parsed.data.tags);
  res.json({ tags: listTagsForHighlight(getDb(), req.params.id) });
});
