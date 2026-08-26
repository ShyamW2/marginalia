import { describe, expect, it } from "vitest";
import { SettingsSchema } from "@marginalia/shared";
import { createDb } from "../db.js";
import { getSettings, updateSettings } from "./store.js";

describe("settings store", () => {
  it("returns a schema-valid bag of defaults on an untouched database", () => {
    const settings = getSettings(createDb(":memory:"));
    // The whole bag, not just the new field: every default has to round-trip
    // through the schema the client parses, and a field added to one and not
    // the other is exactly the mistake this catches.
    expect(SettingsSchema.safeParse(settings).success).toBe(true);
  });

  it("defaults pageTransition to slide (M20 step 3, decisions.md 2026-08-03)", () => {
    // Unlike every other reading setting here, this default is *not* "today's
    // behavior unchanged" — the curl shipped as the only transition, and this
    // deliberately makes the quieter one the one a reader gets without asking.
    expect(getSettings(createDb(":memory:")).pageTransition).toBe("slide");
  });

  it("round-trips pageTransition through its own settings row", () => {
    // The field name and the snake_case key are two separate tables in
    // store.ts; a setting saved into a key nothing reads back is silent.
    const db = createDb(":memory:");
    expect(updateSettings(db, { pageTransition: "curl" }).pageTransition).toBe("curl");
    expect(getSettings(db).pageTransition).toBe("curl");
    expect(
      (db.prepare("SELECT value FROM settings WHERE key = 'page_transition'").get() as
        | { value: string }
        | undefined)?.value,
    ).toBe("curl");
    expect(updateSettings(db, { pageTransition: "slide" }).pageTransition).toBe("slide");
  });

  it("defaults the four kind labels to the operator's names (M30 A, decisions.md 2026-08-24)", () => {
    const settings = getSettings(createDb(":memory:"));
    expect(settings.kindLabelRose).toBe("Regular annotation");
    expect(settings.kindLabelSage).toBe("Define");
    expect(settings.kindLabelHoney).toBe("Key quote");
    expect(settings.kindLabelSlate).toBe("Thematic Question");
  });

  it("clearing a kind label to '' falls back to the default instead of persisting blank", () => {
    // Acceptance (TASKS.md M30 A): "clearing a label field and reloading
    // shows the default name, not a blank tooltip or an empty aria-label."
    const db = createDb(":memory:");
    expect(updateSettings(db, { kindLabelHoney: "Banger" }).kindLabelHoney).toBe("Banger");
    expect(updateSettings(db, { kindLabelHoney: "" }).kindLabelHoney).toBe("Key quote");
    expect(
      db.prepare("SELECT value FROM settings WHERE key = 'kind_label_honey'").get(),
    ).toBeUndefined();
  });
});
