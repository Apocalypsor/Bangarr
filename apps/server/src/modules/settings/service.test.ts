import { expect, test } from "bun:test";
import { SettingsService } from "@server/modules/settings/service";
import { testContext } from "@server/utils/testing";

test("retired matching margin is omitted while saved confidence and unrelated settings survive", () => {
  const context = testContext();
  try {
    expect(SettingsService.read(context).sync.confidence).toBe(0.6);
    SettingsService.set(
      context,
      "app",
      JSON.stringify({
        sync: {
          confidence: 0.93,
          minMargin: 0.2,
          blockedKeywords: ["blocked"],
          animeCompleted: true,
        },
        scheduler: { timezone: "America/New_York" },
      }),
    );
    const current = SettingsService.read(context);
    expect(current.sync.confidence).toBe(0.93);
    expect(current.sync).not.toHaveProperty("minMargin");
    expect(current.sync.blockedKeywords).toEqual(["blocked"]);
    expect(current.sync.animeCompleted).toBe(true);
    expect(current.scheduler.timezone).toBe("America/New_York");
    expect(SettingsService.save(context, current)).toEqual(current);
  } finally {
    context.dispose();
  }
});
