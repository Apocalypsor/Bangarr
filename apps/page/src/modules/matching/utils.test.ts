import { expect, test } from "bun:test";
import { candidateEpisodes } from "@page/modules/matching/utils";

test("episode summaries deduplicate accounts without hiding gaps or mixing specials and movies", () => {
  const tasks = [4, 1, 2, 1, 6, 5, 9].map((episode) => ({
    jobId: String(episode),
    episode,
    mediaType: "episode",
    plexUser: null,
    plexAccountName: null,
    accountName: null,
  }));
  expect(candidateEpisodes({ season: 1, tasks })).toBe(
    "S1E1–E2、S1E4–E6、S1E9",
  );
  expect(candidateEpisodes({ season: 0, tasks: tasks.slice(0, 1) })).toBe(
    "S0E4",
  );
  const first = tasks[0];
  if (!first) throw new Error("missing fixture");
  expect(
    candidateEpisodes({ season: 1, tasks: [{ ...first, episode: null }] }),
  ).toBe("集数未知");
  expect(
    candidateEpisodes({
      season: 1,
      tasks: [{ ...first, mediaType: "movie" }],
    }),
  ).toBe("电影");
});
