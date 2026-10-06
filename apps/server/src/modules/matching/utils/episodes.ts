import type { BangumiEpisode, BangumiSubject } from "@server/clients/bangumi";
import { seasonNumbers } from "@server/modules/matching/utils/title";

export interface EpisodeSegment {
  subject: BangumiSubject;
  episodes: BangumiEpisode[];
}

/** Require an unambiguous relation order before adding episode counts together. */
export const orderSegments = (
  segments: EpisodeSegment[],
  successors: Map<number, Set<number>>,
) => {
  const reaches = (from: number, target: number) => {
    const pending = [from];
    const seen = new Set<number>();

    while (pending.length) {
      const id = pending.pop();

      if (id === undefined || seen.has(id)) continue;

      seen.add(id);

      for (const next of successors.get(id) ?? []) {
        if (next === target) return true;

        pending.push(next);
      }
    }

    return false;
  };

  for (const a of segments)
    for (const b of segments)
      if (
        a !== b &&
        reaches(a.subject.id, b.subject.id) ===
          reaches(b.subject.id, a.subject.id)
      )
        return null;

  return [...segments].sort((a, b) =>
    a === b ? 0 : reaches(a.subject.id, b.subject.id) ? -1 : 1,
  );
};

export const groupSeasonSegments = (ordered: EpisodeSegment[]) => {
  const seasons = new Map<number, EpisodeSegment[]>();
  let season = 1;

  for (const [index, segment] of ordered.entries()) {
    const title = `${segment.subject.name} ${segment.subject.name_cn}`;
    const explicit = seasonNumbers(title);

    if (explicit.size > 1) return null;

    const declared = [...explicit][0];

    if (declared !== undefined) season = declared;
    else if (index > 0 && !isContinuationTitle(title)) season++;

    const group = seasons.get(season) ?? [];

    group.push(segment);
    seasons.set(season, group);
  }

  return seasons;
};

export const findCumulativeEpisode = (
  segments: EpisodeSegment[],
  target: number,
) => {
  let preceding = 0;

  for (const segment of segments) {
    const normal = segment.episodes.filter(
      (ep) => ep.type === 0 && Number.isInteger(ep.sort),
    );

    const first = Math.min(...normal.map((ep) => ep.sort));
    const last = Math.max(...normal.map((ep) => ep.sort));
    // Missing chapters must not compress a segment and shift every later episode.
    const declared = segment.subject.eps ?? 0;

    const span = Math.max(
      last - first + 1,
      Number.isInteger(declared) ? declared : 0,
    );

    if (!normal.length) return undefined;

    if (target <= preceding + span) {
      const episode = findLocalEpisode(normal, target - preceding);

      return episode
        ? { subjectId: segment.subject.id, episodeId: episode.id }
        : undefined;
    }

    preceding += span;
  }

  return undefined;
};

const isContinuationTitle = (title: string) =>
  /(?:part|cour)\s*(?:[2-9]|ii|iii|iv)\b|第\s*[2-9二三四五六七八九]\s*(?:部分|クール)|後半|后半|後篇|后篇/i.test(
    title.normalize("NFKC"),
  );

/** Bangumi sort may start at 76 while the local episode number starts at 1. */
export const findLocalEpisode = (
  episodes: BangumiEpisode[],
  target: number,
) => {
  const normal = episodes.filter(
    (ep) => ep.type === 0 && Number.isFinite(ep.sort),
  );
  const first = normal.length ? Math.min(...normal.map((ep) => ep.sort)) : null;

  if (first !== null) {
    const relative = normal.filter((ep) => ep.sort - first + 1 === target);

    if (relative.length === 1) return relative[0];
  }

  const exact = episodes.filter((ep) => ep.sort === target);

  if (exact.length === 1) return exact[0];

  const local = episodes.filter((ep) => ep.ep === target && ep.ep <= ep.sort);

  return local.length === 1 ? local[0] : undefined;
};

/** A single subject can contain several seasons with ep or sort resetting to 1. */
export const findMergedSeasonEpisode = (
  episodes: BangumiEpisode[],
  season: number,
  target: number,
) => {
  if (season < 2) return undefined;

  const sorted = episodes
    .filter((ep) => ep.type === 0)
    .sort((a, b) => a.id - b.id);
  const useEp =
    sorted.filter((ep) => (ep.ep ?? 0) > 0).length >= sorted.length / 2;
  const groups: BangumiEpisode[][] = [];
  let previous = 0;

  for (const ep of sorted) {
    const number = useEp ? (ep.ep ?? 0) : ep.sort;

    if (!groups.length || (number === 1 && previous > 1)) groups.push([]);

    groups[groups.length - 1]?.push(ep);
    previous = number;
  }

  const group = groups[season - 1];

  return group ? findLocalEpisode(group, target) : undefined;
};

export const dateDistance = (left: string, right: string) => {
  const a = Date.parse(left);
  const b = Date.parse(right);

  return Number.isFinite(a) && Number.isFinite(b)
    ? Math.abs(a - b) / 86400000
    : null;
};
