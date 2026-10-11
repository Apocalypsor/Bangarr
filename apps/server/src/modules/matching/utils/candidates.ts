import type {
  BangumiEpisode,
  BangumiSubject,
} from "@server/clients/bangumi/types";
import type { MatchCandidate } from "@server/modules/matching/types";
import type { EpisodeSegment } from "@server/modules/matching/utils/episodes";
import {
  dateDistance,
  findLocalEpisode,
} from "@server/modules/matching/utils/episodes";
import { normalizeTitle } from "@server/modules/matching/utils/title";
import type { Settings } from "@server/modules/settings/model";

const exactTitleMaxDays = 180;
const partialTitleMaxDays = 90;
const catalogMaxDays = 365;

export const currentTitleDate = (date: string, releaseDate: string) =>
  (dateDistance(date, releaseDate) ?? Infinity) <= exactTitleMaxDays;

export const selectCandidate = (
  scored: MatchCandidate[],
  subjects: Map<number, BangumiSubject>,
  names: string[],
  releaseDate: string,
  config: Pick<Settings["sync"], "confidence" | "minMargin">,
) => {
  const trace: Record<string, unknown>[] = [];
  const exact = scored.filter((row) => row.score === 1);

  const catalogDate = selectDatedSubject(scored, subjects, names, releaseDate);
  if (catalogDate === null)
    return {
      candidate: undefined,
      trace: [
        ...trace,
        {
          step: "date-disambiguation",
          reason: "多个相关条目的放送日期同样接近，无法唯一确认",
        },
      ],
    };

  if (catalogDate) {
    trace.push({
      step: "date-disambiguation",
      method: catalogDate.method,
      subjectId: catalogDate.candidate.id,
      days: catalogDate.days,
    });
    return {
      candidate: {
        ...catalogDate.candidate,
        dateMatched: catalogDate.days <= exactTitleMaxDays,
      },
      trace,
    };
  }

  const dated = candidatesByDate(
    exact.length
      ? exact
      : scored.filter(
          (row) =>
            row.score >=
            Math.max(
              config.confidence,
              (scored[0]?.score ?? 0) - config.minMargin,
            ),
        ),
    releaseDate,
  );

  if (dated[0] && dated[0].days <= 7 && (!dated[1] || dated[1].days > 14)) {
    trace.push({
      step: "date-disambiguation",
      subjectId: dated[0].candidate.id,
      days: dated[0].days,
    });

    return { candidate: dated[0].candidate, trace };
  }

  if (exact.length === 1) {
    if (
      releaseDate &&
      exact[0]?.date &&
      (dateDistance(exact[0].date, releaseDate) ?? 0) > catalogMaxDays
    )
      return {
        candidate: undefined,
        trace: [
          ...trace,
          {
            step: "date-disambiguation",
            reason:
              "同名条目的放送日期相差超过一年，未找到日期与名称均相符的候选",
          },
        ],
      };
    trace.push({ step: "unique-exact-title", subjectId: exact[0]?.id });

    return { candidate: exact[0], trace };
  }

  const first = scored[0];
  const second = scored[1];

  if (
    !first ||
    first.score < config.confidence ||
    (second &&
      (first.score === second.score ||
        first.score - second.score < config.minMargin))
  )
    return { candidate: undefined, trace };

  return { candidate: first, trace };
};

// Bangumi-syncer: nearest exact title within 180 days; otherwise search
// name-related partial titles within 90 days. Never use a date alone as identity.
// Null denotes ambiguity and must prevent fallback to an older exact title.
export const selectDatedSubject = (
  candidates: MatchCandidate[],
  subjects: Map<number, BangumiSubject>,
  names: string[],
  releaseDate: string,
) => {
  if (!releaseDate) return undefined;
  const dated = candidatesByDate(candidates, releaseDate);
  const exact = dated.filter(({ candidate }) => candidate.score === 1);
  const nearest = exact[0];

  if (nearest && nearest.days <= exactTitleMaxDays)
    return exact[1]?.days === nearest.days
      ? null
      : { ...nearest, method: "exact-title-date" };

  if (nearest && nearest.days > exactTitleMaxDays) {
    const partial = dated.filter(({ candidate, days }) => {
      const subject = subjects.get(candidate.id);
      if (candidate.score === 1 || days > partialTitleMaxDays || !subject)
        return false;
      return (
        referencePartialScore(subject, names, days) >= 0.8 ||
        subjectAliases(subject).some((alias) =>
          names.some((name) => {
            const left = normalizeTitle(name),
              right = normalizeTitle(alias);
            return Boolean(
              left &&
                right &&
                (right.includes(left) ||
                  (left.length > 3 &&
                    right.length > 3 &&
                    titleRatio(left, right) > 0.9)),
            );
          }),
        )
      );
    });
    if (partial[0])
      return partial[1]?.days === partial[0].days
        ? null
        : { ...partial[0], method: "partial-title-date" };
  }

  // The reference rejects distant catalog matches beyond its 365-day guard.
  if (nearest && nearest.days <= catalogMaxDays)
    return exact[1]?.days === nearest.days
      ? null
      : { ...nearest, method: "exact-title-date" };
  return undefined;
};

// Same score components as the reference _calculate_match_info.
const referencePartialScore = (
  subject: BangumiSubject,
  names: string[],
  days: number,
) => {
  const title = names[0] ?? "";
  const original = names[1] ?? "";
  const aliases = [subject.name_cn, ...(subject.aliases ?? [])].filter(Boolean);
  const best =
    [...aliases].sort(
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
  const keyTitle = normalizeTitle(title),
    keyBest = normalizeTitle(best);
  if (
    keyTitle &&
    keyBest &&
    (keyTitle === keyBest ||
      (keyTitle.length > 3 &&
        keyBest.length > 3 &&
        titleRatio(keyTitle, keyBest) > 0.9))
  )
    score += 0.1;
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

// RapidFuzz fuzz.ratio uses normalized Indel similarity: 2 * LCS / total length.
const titleRatio = (left: string, right: string) => {
  const a = [...left],
    b = [...right];
  if (!a.length || !b.length) return 0;
  const lengths = new Array<number>(b.length + 1).fill(0);
  for (const char of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const previous = lengths[j] ?? 0;
      lengths[j] =
        char === b[j - 1]
          ? diagonal + 1
          : Math.max(previous, lengths[j - 1] ?? 0);
      diagonal = previous;
    }
  }
  return (2 * (lengths[b.length] ?? 0)) / (a.length + b.length);
};

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

  return episodeDateConflicts(episode, releaseDate);
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

export const episodeDateConflicts = (
  episode: BangumiEpisode | undefined,
  releaseDate: string,
) =>
  Boolean(
    episode?.airdate &&
      releaseDate &&
      (dateDistance(episode.airdate, releaseDate) ?? 0) > 45,
  );

const candidatesByDate = (candidates: MatchCandidate[], releaseDate: string) =>
  candidates
    .flatMap((candidate) => {
      const days = dateDistance(candidate.date, releaseDate);
      return days === null ? [] : [{ candidate, days }];
    })
    .sort((a, b) => a.days - b.days);
