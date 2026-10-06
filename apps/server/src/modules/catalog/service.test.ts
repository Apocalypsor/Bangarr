import { afterEach, expect, test } from "bun:test";
import { CatalogStore } from "@server/db/catalog";
import { CatalogService } from "@server/modules/catalog/service";
import { testContext } from "@server/utils/testing";

const disposables: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposables.splice(0)) dispose();
});

const fixture = () => {
  const context = testContext();

  disposables.push(context.dispose);

  const settings = {
    database: context.database,
    vault: context.vault,
  };
  const store = new CatalogStore(context.database.path);

  return { ...context, settings, store };
};

test("bangumi-data indexes translations; a broken update preserves prior data", async () => {
  const { store, settings } = fixture();
  let bad = false;

  const service = {
    ...settings,
    transport: async () =>
      Response.json(
        bad
          ? { items: [] }
          : {
              items: [
                {
                  title: "Test Anime",
                  titleTranslate: { "zh-Hans": ["测试动画", "别名动画"] },
                  begin: "2024-01-01T00:00:00Z",
                  sites: [{ site: "bangumi", id: "12" }],
                },
              ],
            },
      ),
  };

  expect(await CatalogService.refreshData(service)).toEqual({ subjects: 1 });
  expect(store.search(["别名动画"])[0]?.id).toBe(12);
  expect(store.status().ready).toBe(true);
  bad = true;
  await expect(CatalogService.refreshData(service)).rejects.toThrow("为空");
  expect(store.search(["Test Anime"])[0]?.id).toBe(12);
});
