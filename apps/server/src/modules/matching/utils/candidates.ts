import type { BangumiEpisode, BangumiSubject } from "@server/clients/bangumi";
import type { EpisodeSegment } from "@server/modules/matching/utils/episodes";
import {
  dateDistance,
  findLocalEpisode,
} from "@server/modules/matching/utils/episodes";

export const findEpisode = (
  episodes: BangumiEpisode[],
  target: number,
  seasonMatched: boolean,
  releaseDate: string,
) => {
  if (episodes.length >= 100 && releaseDate) {
    const dated = episodes.filter((ep) => ep.airdate === releaseDate);

    if (dated.length === 1) return dated[0];
  }

  if (seasonMatched || target <= episodes.length)
    return findLocalEpisode(episodes, target);

  const exact = episodes.filter((ep) => ep.sort === target);

  return exact.length === 1 ? exact[0] : findLocalEpisode(episodes, target);
};

export const conflictingEpisodeDate = (
  chain: EpisodeSegment[],
  target: {
    subjectId: number;
    episodeId: number;
  },
  releaseDate: string,
) => {
  const episode = chain
    .find((entry) => entry.subject.id === target.subjectId)
    ?.episodes.find((ep) => ep.id === target.episodeId);

  return (
    episode?.airdate &&
    releaseDate &&
    (dateDistance(episode.airdate, releaseDate) ?? 0) > 45
  );
};

export const subjectAliases = (subject: BangumiSubject) => {
  const aliases = [subject.name, subject.name_cn, ...(subject.aliases ?? [])];

  for (const info of subject.infobox ?? [])
    if (info.key === "别名") {
      if (typeof info.value === "string") aliases.push(info.value);

      if (Array.isArray(info.value))
        for (const value of info.value)
          if (typeof value?.v === "string") aliases.push(value.v);
    }

  return aliases.filter(Boolean);
};

export const mergeSubject = (
  subjects: Map<number, BangumiSubject>,
  subject: BangumiSubject,
) => {
  const prior = subjects.get(subject.id);

  subjects.set(subject.id, {
    ...prior,
    ...subject,
    aliases: [
      ...new Set([
        ...(prior ? subjectAliases(prior) : []),
        ...subjectAliases(subject),
      ]),
    ],
  });
};

export const isMovie = (subject: BangumiSubject | undefined) =>
  Boolean(
    subject &&
      /剧场版|劇場版|电影|映画|movie/i.test(
        `${subject.platform ?? ""} ${subject.name} ${subject.name_cn}`,
      ),
  );
