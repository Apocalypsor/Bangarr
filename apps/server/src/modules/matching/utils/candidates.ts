import type {
  BangumiEpisode,
  BangumiSubject,
} from "@server/clients/bangumi/types";
import type { PlexItem } from "@server/clients/plex/types";
import type { MatchCandidate } from "@server/modules/matching/types";
import type { EpisodeSegment } from "@server/modules/matching/utils/episodes";
import {
  dateDistance,
  findLocalEpisode,
} from "@server/modules/matching/utils/episodes";
import {
  apiTitleScore,
  normalizeTitle,
  seasonNumbers,
  titleRatio,
} from "@server/modules/matching/utils/title";

type MatchItem = Pick<
  PlexItem,
  "title" | "originalTitle" | "season" | "releaseDate" | "mediaType"
>;

interface CatalogMatch {
  subject: BangumiSubject;
  indexed: boolean;
  exact: boolean;
  matchType: "title" | "zh-hans";
  days: number | null;
  candidate: MatchCandidate;
}

// Bangumi-syncer 8155715: bangumi_data/matching.py and steps/bangumi_data.py.
// These date windows belong to the local catalog only. A miss continues to API search.
export const selectCatalogSubject = (
  subjects: BangumiSubject[],
  item: MatchItem,
) => {
  const trace: Record<string, unknown>[] = [];
  const rows: CatalogMatch[] = subjects.map((subject) => {
    const aliases = [subject.name_cn, ...(subject.aliases ?? [])].filter(
      Boolean,
    );
    const chinese = aliases.some((name) => titleRatio(item.title, name) > 0.9);
    const original = (item.originalTitle || item.title) === subject.name;
    const indexed = subjectAliases(subject).some(
      (name) =>
        name === item.title ||
        Boolean(item.originalTitle && name === item.originalTitle),
    );
    const days = dateDistance(subject.date ?? "", item.releaseDate);
    const score =
      indexed || original
        ? 1
        : chinese
          ? Math.max(...aliases.map((name) => titleRatio(item.title, name)))
          : referencePartialScore(
              subject,
              [item.title, item.originalTitle],
              days ?? Infinity,
            );
    return {
      subject,
      indexed,
      exact: chinese || original,
      matchType: chinese ? "zh-hans" : "title",
      days,
      candidate: candidateOf(subject, score, "data"),
    };
  });
  let selected: CatalogMatch | undefined;
  let dateMatched = false;
  const byDate = (a: CatalogMatch, b: CatalogMatch) =>
    (a.days ?? Infinity) - (b.days ?? Infinity);
  const indexed = rows.filter((row) => row.indexed);
  if (item.releaseDate) {
    const nearest = indexed.toSorted(byDate)[0];
    if (nearest && nearest.days !== null && nearest.days <= 180) {
      selected = nearest;
      dateMatched = true;
    }
  } else {
    selected =
      indexed.find((row) => subjectMediaType(row.subject) === item.mediaType) ??
      indexed[0];
  }
  if (!selected) {
    const exact = rows
      .filter((row) => row.exact)
      .sort((a, b) => a.matchType.localeCompare(b.matchType));
    const partial = rows.filter((row) => !row.exact);
    const nearest = exact.toSorted(byDate)[0];
    if (item.releaseDate && exact.length && (nearest?.days ?? Infinity) > 180) {
      selected = partial
        .toSorted(byDate)
        .find(
          (row) =>
            row.days !== null &&
            row.days <= 90 &&
            (row.candidate.score >= 0.8 ||
              subjectAliases(row.subject).some(
                (name) =>
                  name.includes(item.title) ||
                  keyCharactersMatch(item.title, name),
              )),
        );
      dateMatched = Boolean(selected);
    }
    if (!selected && exact.length) {
      selected = item.releaseDate && exact.length > 1 ? nearest : exact[0];
      dateMatched = Boolean(
        item.season > 1 &&
          exact.length > 1 &&
          selected?.days !== null &&
          (selected?.days ?? Infinity) <= 180,
      );
    }
    if (!selected && !exact.length)
      selected = partial
        .toSorted((a, b) => b.candidate.score - a.candidate.score)
        .find((row) => row.candidate.score >= 0.6);
  }
  const rejected = (selected?.days ?? 0) > 365;
  const candidate =
    selected && !rejected
      ? {
          ...selected.candidate,
          seasonMatched:
            item.season <= 1 ||
            dateMatched ||
            subjectSeasons(selected.subject).has(item.season),
        }
      : undefined;

  trace.push({
    step: "local-catalog",
    candidates: rows.length,
    subjectId: selected?.subject.id,
    outcome: selected && !rejected ? "hit" : "miss",
    reason: rejected ? "条目日期相差超过 365 天，继续在线搜索" : undefined,
  });
  if (selected && !rejected) {
    trace.push({
      step: "date-disambiguation",
      source: "data",
      subjectId: selected.subject.id,
      days: selected.days,
      dateMatched,
    });
  }

  return {
    rejected,
    candidate,
    candidates: rows.map((row) => row.candidate),
    trace,
  };
};

export const apiCandidate = (
  subject: BangumiSubject,
  item: MatchItem,
): MatchCandidate => {
  let score = apiTitleScore(
    item.title,
    item.originalTitle,
    subjectAliases(subject),
  );
  const requested = seasonNumbers(item.title);
  const candidate = subjectSeasons(subject);
  // Reference search._apply_season_penalty uses explicit titles, not the Plex season field.
  if (
    requested.size === 1 &&
    candidate.size === 1 &&
    !requested.has([...candidate][0] ?? 0)
  )
    score = Math.max(0, score - 0.15);
  return candidateOf(subject, score, "bangumi");
};

// Stable platform ordering and post_search reselection precede the single confidence gate.
export const selectApiSubject = (
  subjects: BangumiSubject[],
  item: MatchItem,
) => {
  const ordered = subjects
    .toSorted(
      (a, b) =>
        platformWeight(b, item.mediaType) - platformWeight(a, item.mediaType),
    )
    .slice(0, 15);
  let subject = ordered[0];
  let seasonMatched = false;
  if (subject) {
    if (item.season > 1 && subjectSeasons(subject).has(item.season))
      seasonMatched = true;
    else if (Math.max(0, ...subjectSeasons(subject)) > 1) {
      const base = ordered.find((row) => subjectSeasons(row).size === 0);
      if (base) {
        subject = base;
        seasonMatched = true;
      }
    }
    if (!seasonMatched && subjectMediaType(subject) !== item.mediaType) {
      const matching = ordered.filter(
        (row) => subjectMediaType(row) === item.mediaType,
      );
      const replacement =
        matching.find(
          (row) => row.name === item.title || row.name_cn === item.title,
        ) ??
        matching.find((row) => subjectSeasons(row).size > 0) ??
        matching[0];
      if (replacement) {
        subject = replacement;
        seasonMatched = true;
      }
    }
  }
  return {
    subject,
    seasonMatched,
    candidates: ordered.map((row) => apiCandidate(row, item)),
  };
};

export const searchDateWindow = (releaseDate: string, movie = false) => {
  const time = Date.parse(releaseDate);
  if (!Number.isFinite(time)) return undefined;
  return {
    startDate: new Date(time - 2 * 86400000).toISOString().slice(0, 10),
    endDate: new Date(time + (movie ? 200 : 2) * 86400000)
      .toISOString()
      .slice(0, 10),
  };
};

const candidateOf = (
  subject: BangumiSubject,
  score: number,
  source: string,
): MatchCandidate => ({
  id: subject.id,
  name: subject.name,
  nameCn: subject.name_cn,
  date: subject.date ?? "",
  score,
  source,
});

const subjectSeasons = (subject: BangumiSubject) =>
  seasonNumbers(`${subject.name} ${subject.name_cn}`);

const keyCharactersMatch = (left: string, right: string) => {
  const a = normalizeTitle(left),
    b = normalizeTitle(right);
  return Boolean(
    a &&
      b &&
      (a === b || (a.length > 3 && b.length > 3 && titleRatio(a, b) > 0.9)),
  );
};

const platformWeight = (
  subject: BangumiSubject,
  mediaType: PlexItem["mediaType"],
) => platformWeights[subject.platform ?? ""]?.[mediaType] ?? 50;

const platformWeights: Record<string, Record<PlexItem["mediaType"], number>> = {
  TV: { episode: 100, movie: 40 },
  WEB: { episode: 90, movie: 40 },
  日剧: { episode: 85, movie: 30 },
  欧美剧: { episode: 85, movie: 30 },
  华语剧: { episode: 85, movie: 30 },
  电视剧: { episode: 85, movie: 30 },
  OVA: { episode: 70, movie: 70 },
  剧场版: { episode: 50, movie: 100 },
  电影: { episode: 50, movie: 100 },
  短片: { episode: 30, movie: 60 },
  动态漫画: { episode: 20, movie: 20 },
  演出: { episode: 10, movie: 10 },
  综艺: { episode: 10, movie: 10 },
  其他: { episode: 0, movie: 0 },
};

const referencePartialScore = (
  subject: BangumiSubject,
  names: string[],
  days: number,
) => {
  const title = names[0] ?? "",
    original = names[1] ?? "";
  const aliases = [subject.name_cn, ...(subject.aliases ?? [])].filter(Boolean);
  const best =
    aliases.toSorted(
      (a, b) => titleRatio(title, b) - titleRatio(title, a),
    )[0] ?? "";
  const ratio = titleRatio(title, best);
  let score = ratio * 0.6;
  if (ratio > 0.8) score += 0.2;
  if (
    title &&
    aliases.some((alias) => title.includes(alias) || alias.includes(title))
  )
    score += 0.15;
  if (keyCharactersMatch(title, best)) score += 0.1;
  const sourceTitle = original || title;
  score += titleRatio(sourceTitle, subject.name) * (original ? 0.3 : 0.2);
  if (
    sourceTitle &&
    subject.name &&
    (sourceTitle.includes(subject.name) || subject.name.includes(sourceTitle))
  )
    score += 0.1;
  score += days <= 30 ? 0.15 : days <= 120 ? 0.05 : 0;
  return Math.min(1, score);
};

export const findEpisode = (
  episodes: BangumiEpisode[],
  target: number,
  seasonMatched: boolean,
  releaseDate: string,
) => {
  if (episodes.length >= 100 && releaseDate) {
    const dated = episodes.filter(
      (ep) => ep.airdate === releaseDate && ep.sort > 0,
    );

    if (dated.length === 1) return dated[0];
  }

  if (seasonMatched || target <= episodes.length)
    return findLocalEpisode(episodes, target, false);

  const exact = episodes.filter((ep) => ep.sort === target);

  return exact.length === 1
    ? exact[0]
    : findLocalEpisode(episodes, target, false);
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

  return episodeDateConflicts(episode, releaseDate);
};

const subjectAliases = (subject: BangumiSubject) => {
  const aliases = [subject.name, subject.name_cn, ...(subject.aliases ?? [])];

  for (const info of subject.infobox ?? [])
    if (info.key === "别名") {
      if (typeof info.value === "string") aliases.push(info.value);

      if (Array.isArray(info.value))
        for (const value of info.value) {
          if (typeof value === "string") aliases.push(value);
          else if (typeof value?.v === "string") aliases.push(value.v);
        }
    }

  return [...new Set(aliases.filter(Boolean))];
};

// Candidate classification follows title keywords; platform is used only for ranking.
export const subjectMediaType = (subject: BangumiSubject) => {
  if (subject.type === 6) return "real_action";
  const title = `${subject.name} ${subject.name_cn}`;
  if (/\bOVA\b/i.test(title)) return "ova";
  if (/\bOAD\b/i.test(title)) return "oad";
  if (/特别篇|特別篇|_special|\.SP\b|\bSP\b/i.test(title)) return "ova";
  if (/剧场版|劇場版|电影|電影|\bMovie\b|\bFilm\b/i.test(title)) return "movie";
  return "episode";
};

export const episodeDateConflicts = (
  episode: BangumiEpisode | undefined,
  releaseDate: string,
) =>
  Boolean(
    episode?.airdate &&
      releaseDate &&
      (dateDistance(episode.airdate, releaseDate) ?? 0) > 45,
  );
