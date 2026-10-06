import type { useCandidatesQuery } from "@page/hooks/use-matching-queries";

type Candidate = NonNullable<
  ReturnType<typeof useCandidatesQuery>["data"]
>[number];

export const candidateEpisodes = (
  candidate: Pick<Candidate, "season" | "tasks">,
) => {
  const episodes = [
    ...new Set(
      candidate.tasks
        .filter((task) => task.mediaType !== "movie" && task.episode !== null)
        .map((task) => task.episode as number),
    ),
  ].sort((a, b) => a - b);
  const ranges: string[] = [];

  for (let index = 0; index < episodes.length; index++) {
    const start = episodes[index] as number;
    let end = start;
    while (episodes[index + 1] === end + 1) end = episodes[++index] as number;
    ranges.push(
      `S${candidate.season}E${start}${end === start ? "" : `–E${end}`}`,
    );
  }

  if (candidate.tasks.some((task) => task.mediaType === "movie"))
    ranges.push("电影");
  if (
    candidate.tasks.some(
      (task) => task.mediaType !== "movie" && task.episode === null,
    )
  )
    ranges.push("集数未知");
  return ranges.join("、") || "集数未知";
};
