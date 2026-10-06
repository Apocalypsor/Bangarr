import type { BangumiClient, BangumiSubject } from "@server/clients/bangumi";
import type { PlexItem } from "@server/clients/plex";
import { CatalogStore } from "@server/db/catalog";
import { transaction } from "@server/db/client";
import {
  deleteMapping,
  findMappingIdentity,
  findSeasonMappings,
  getMapping,
  getPendingCandidate,
  listMappings,
  listPendingCandidates,
  updateCandidateState,
  updateMapping,
  upsertMapping,
} from "@server/db/matching";
import { JobsService } from "@server/modules/jobs/service";
import type {
  MappingInput,
  MatchCandidate,
  MatchResult,
} from "@server/modules/matching/types";
import {
  conflictingEpisodeDate,
  findEpisode,
  isMovie,
  mergeSubject,
  subjectAliases,
} from "@server/modules/matching/utils/candidates";
import type { EpisodeSegment } from "@server/modules/matching/utils/episodes";
import {
  dateDistance,
  findCumulativeEpisode,
  findMergedSeasonEpisode,
  groupSeasonSegments,
  orderSegments,
} from "@server/modules/matching/utils/episodes";
import {
  normalizeTitle,
  seasonNumbers,
  similarity,
} from "@server/modules/matching/utils/title";
import type { Settings } from "@server/modules/settings/model";
import { SettingsService } from "@server/modules/settings/service";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";

export class NeedsConfirmation extends AppError {
  constructor(
    public candidates: MatchCandidate[],
    public trace: Record<string, unknown>[],
  ) {
    super(409, "NEEDS_CONFIRMATION", "匹配结果需要人工确认");
  }
}

export class BlockedTitle extends AppError {
  constructor() {
    super(400, "BLOCKED_TITLE", "作品命中屏蔽关键词");
  }
}

export abstract class MatchingService {
  static async match(
    context: Pick<AppContext, "database">,
    item: PlexItem,
    api: BangumiClient,
    config: Settings,
  ): Promise<MatchResult> {
    const trace: Record<string, unknown>[] = [];
    const rules = findSeasonMappings(context.database, item.season);

    const names = [
      ...new Set(
        [item.title, item.originalTitle]
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];

    const mapping = [item.season, -1].flatMap((season) =>
      names.flatMap((name) =>
        rules.filter((rule) => rule.season === season && rule.title === name),
      ),
    )[0];

    if (mapping) {
      trace.push({
        step: "mapping",
        subjectId: mapping.subjectId,
        offset: mapping.episodeOffset,
      });

      const episode = await MatchingService.resolveEpisode(
        context,
        { ...item, episode: item.episode + mapping.episodeOffset },
        api,
        mapping.subjectId,
        !mapping.resolveSeries,
        trace,
      );

      return { ...episode, trace, mapped: true };
    }

    if (
      config.sync.blockedKeywords.some((word) =>
        normalizeTitle(item.title).includes(normalizeTitle(word)),
      )
    )
      throw new BlockedTitle();

    const first = await MatchingService.selectSubject(
      context,
      item,
      api,
      config,
      trace,
    );

    const explicit = seasonNumbers(`${first.name} ${first.nameCn}`);
    const seasonMatched = explicit.size === 1 && explicit.has(item.season);

    const episode = await MatchingService.resolveEpisode(
      context,
      item,
      api,
      first.id,
      seasonMatched,
      trace,
    );

    return { ...episode, trace, mapped: false };
  }

  static async selectSubject(
    context: Pick<AppContext, "database">,
    item: PlexItem,
    api: BangumiClient,
    config: Settings,
    trace: Record<string, unknown>[] = [],
  ) {
    const names = [
      ...new Set(
        [item.title, item.originalTitle]
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];

    const subjects = new Map<number, BangumiSubject>();

    const local = config.bangumi.dataEnabled
      ? new CatalogStore(context.database.path).search(names)
      : [];

    for (const candidate of local) mergeSubject(subjects, candidate);

    const exactIds = new Set(
      local
        .filter((subject) =>
          subjectAliases(subject).some((alias) =>
            names.some(
              (name) => normalizeTitle(name) === normalizeTitle(alias),
            ),
          ),
        )
        .map((subject) => subject.id),
    );

    trace.push({
      step: "local-catalog",
      candidates: local.length,
      exact: [...exactIds],
    });

    if (exactIds.size !== 1) {
      for (const name of names)
        for (const subject of await api.search(name, config.sync.realAction))
          mergeSubject(subjects, subject);
    }

    const scored = [...subjects.values()]
      .filter(
        (subject) =>
          subject.type === 2 || (config.sync.realAction && subject.type === 6),
      )
      .map((subject) => {
        const aliases = subjectAliases(subject);
        const season = seasonNumbers(`${subject.name} ${subject.name_cn}`);

        let score = Math.max(
          ...names.flatMap((name) =>
            aliases.map((alias) => similarity(name, alias)),
          ),
          0,
        );

        if (
          score < 1 &&
          season.size === 1 &&
          !season.has(item.season) &&
          item.season !== 0
        )
          score *= 0.75;

        return {
          id: subject.id,
          name: subject.name,
          nameCn: subject.name_cn,
          date: subject.date ?? "",
          score,
          source:
            local.find((row) => row.id === subject.id)?.source ?? "bangumi",
        };
      })
      .sort((a, b) => b.score - a.score || a.id - b.id);

    const eligibleMovies = scored.filter(
      (row) =>
        row.score >= config.sync.confidence && isMovie(subjects.get(row.id)),
    );

    if (item.mediaType === "movie" && eligibleMovies.length)
      for (const row of scored)
        if (!isMovie(subjects.get(row.id))) row.score *= 0.75;

    if (
      item.mediaType === "episode" &&
      item.season > 0 &&
      !item.releaseDate &&
      !names.some((name) => /\b(?:OVA|OAD|SP)\b/i.test(name)) &&
      scored.some(
        (row) =>
          row.score === 1 &&
          ["TV", "WEB"].includes(subjects.get(row.id)?.platform ?? ""),
      )
    )
      for (const row of scored)
        if (["OVA", "剧场版"].includes(subjects.get(row.id)?.platform ?? ""))
          row.score *= 0.75;

    scored.sort((a, b) => b.score - a.score || a.id - b.id);
    trace.push({ step: "search", names, candidates: scored });

    const exact = scored.filter((row) => row.score === 1);

    const dated = (
      exact.length
        ? exact
        : scored.filter(
            (row) =>
              row.score >=
              Math.max(
                config.sync.confidence,
                (scored[0]?.score ?? 0) - config.sync.minMargin,
              ),
          )
    )
      .map((row) => ({
        row,
        days:
          item.releaseDate && row.date
            ? dateDistance(row.date, item.releaseDate)
            : null,
      }))
      .filter(
        (
          entry,
        ): entry is {
          row: MatchCandidate;
          days: number;
        } => entry.days !== null,
      )
      .sort((a, b) => a.days - b.days);

    if (dated[0] && dated[0].days <= 7 && (!dated[1] || dated[1].days > 14)) {
      trace.push({
        step: "date-disambiguation",
        subjectId: dated[0].row.id,
        days: dated[0].days,
      });

      return dated[0].row;
    }

    if (exact.length === 1) {
      trace.push({ step: "unique-exact-title", subjectId: exact[0]?.id });

      return exact[0] as MatchCandidate;
    }

    const first = scored[0];
    const second = scored[1];

    if (
      !first ||
      first.score < config.sync.confidence ||
      (second &&
        (first.score === second.score ||
          first.score - second.score < config.sync.minMargin))
    )
      throw new NeedsConfirmation(scored.slice(0, 10), trace);

    return first;
  }

  static async resolveEpisode(
    _context: Pick<AppContext, "database">,
    item: PlexItem,
    api: BangumiClient,
    subjectId: number,
    seasonMatched: boolean,
    trace: Record<string, unknown>[],
  ): Promise<{
    subjectId: number;
    episodeId: number;
  }> {
    if (item.episode > 9999 || item.season > 100 || item.episode < 1)
      throw new AppError(400, "EPISODE_RANGE", "季度或集数超出允许范围");

    const type = item.season === 0 ? 1 : 0;
    const episodes = await api.episodes(subjectId, type);

    if (item.mediaType === "movie") {
      const episode = [...episodes].sort((a, b) => a.sort - b.sort)[0];

      if (!episode)
        throw new NeedsConfirmation(
          [],
          [...trace, { step: "episode", reason: "电影没有正片章节" }],
        );

      return { subjectId, episodeId: episode.id };
    }

    if (!seasonMatched && item.season > 1) {
      const merged = findMergedSeasonEpisode(
        episodes,
        item.season,
        item.episode,
      );

      if (merged) {
        trace.push({
          step: "episode",
          method: "merged-seasons",
          subjectId,
          episodeId: merged.id,
        });

        return { subjectId, episodeId: merged.id };
      }
    }

    const selected = findEpisode(
      episodes,
      item.episode,
      seasonMatched,
      item.releaseDate,
    );

    const conflictingDate =
      selected?.airdate &&
      item.releaseDate &&
      (dateDistance(selected.airdate, item.releaseDate) ?? 0) > 45;

    if (selected && !conflictingDate && (seasonMatched || item.season <= 1)) {
      trace.push({
        step: "episode",
        subjectId,
        episodeId: selected.id,
        method: "direct",
      });

      return { subjectId, episodeId: selected.id };
    }

    // 有界遍历主线关系；不把总集篇、角色出演等误当作新季度。
    const visited = new Set<number>();
    const pending = [subjectId];
    const allSegments: EpisodeSegment[] = [];
    const successors = new Map<number, Set<number>>();
    const deadline = Date.now() + 60000;

    while (pending.length && visited.size < 24) {
      if (Date.now() > deadline)
        throw new AppError(
          503,
          "MATCH_DEADLINE",
          "关联条目查询超时，请稍后重试",
        );

      const id = pending.shift();

      if (!id || visited.has(id)) continue;

      visited.add(id);

      const subject = await api.subject(id);
      const list = id === subjectId ? episodes : await api.episodes(id, type);

      allSegments.push({ subject, episodes: list });

      for (const relation of await api.relations(id)) {
        if (["续集", "前传"].includes(relation.relation)) {
          const from = relation.relation === "续集" ? id : relation.id;
          const to = relation.relation === "续集" ? relation.id : id;
          const next = successors.get(from) ?? new Set<number>();

          next.add(to);
          successors.set(from, next);
        }

        if (
          ["续集", "前传", "主线故事"].includes(relation.relation) &&
          !visited.has(relation.id)
        )
          pending.push(relation.id);
      }
    }

    if (pending.some((id) => !visited.has(id)))
      throw new NeedsConfirmation(
        [],
        [
          ...trace,
          {
            step: "episode",
            reason: "关联图超过 24 个条目，不能依据不完整结果确认季度",
          },
        ],
      );

    const root = allSegments.find(
      (entry) => entry.subject.id === subjectId,
    )?.subject;

    const chain = allSegments.filter(
      ({ subject }) =>
        subject.type === root?.type &&
        (!root.platform ||
          !subject.platform ||
          root.platform === subject.platform) &&
        !/剧场版|劇場版|电影|総集編|总集篇/.test(
          `${subject.name} ${subject.name_cn}`,
        ),
    );

    const dated = item.releaseDate
      ? chain.flatMap((entry) =>
          entry.episodes
            .filter((ep) => ep.airdate === item.releaseDate)
            .map((ep) => ({ subjectId: entry.subject.id, episodeId: ep.id })),
        )
      : [];

    if (dated.length === 1) {
      trace.push({ step: "episode", method: "airdate", ...dated[0] });

      return dated[0] as {
        subjectId: number;
        episodeId: number;
      };
    }

    const exactSeason = chain.filter((entry) => {
      const seasons = seasonNumbers(
        `${entry.subject.name} ${entry.subject.name_cn}`,
      );

      return seasons.size === 1 && seasons.has(item.season);
    });

    const ordered = orderSegments(chain, successors);
    const grouped = ordered ? groupSeasonSegments(ordered) : null;

    const targets =
      grouped?.get(item.season) ??
      (exactSeason.length ? orderSegments(exactSeason, successors) : undefined);

    const cumulative = targets
      ? findCumulativeEpisode(targets, item.episode)
      : undefined;

    if (
      cumulative &&
      !conflictingEpisodeDate(chain, cumulative, item.releaseDate)
    ) {
      trace.push({ step: "episode", method: "season-segments", ...cumulative });

      return cumulative;
    }

    // Only treat a higher-season episode as global numbering when it exceeds
    // the known season. A missing season must never fall back into season one.
    const exceedsSeason =
      targets?.length &&
      item.episode >
        targets.reduce((sum, entry) => sum + entry.episodes.length, 0);

    if (item.season <= 1 || exceedsSeason) {
      const bySort = chain.flatMap((entry) =>
        entry.episodes
          .filter((ep) => ep.sort === item.episode)
          .map((ep) => ({ subjectId: entry.subject.id, episodeId: ep.id })),
      );

      if (
        bySort.length === 1 &&
        !conflictingEpisodeDate(
          chain,
          bySort[0] as {
            subjectId: number;
            episodeId: number;
          },
          item.releaseDate,
        )
      ) {
        trace.push({
          step: "episode",
          method: "continuous-sort",
          ...bySort[0],
        });

        return bySort[0] as {
          subjectId: number;
          episodeId: number;
        };
      }
    }

    throw new NeedsConfirmation(
      chain.map(({ subject }) => ({
        id: subject.id,
        name: subject.name,
        nameCn: subject.name_cn,
        date: subject.date ?? "",
        score: 0,
        source: "relations",
      })),
      [...trace, { step: "episode", reason: "无法唯一确认季度与集数" }],
    );
  }

  static mappings(context: AppContext) {
    return listMappings(context.database);
  }

  static save(context: AppContext, input: MappingInput, id?: string) {
    const title = input.title.trim();

    if (!title) throw new AppError(400, "TITLE_REQUIRED", "映射标题不能为空");

    if (id)
      return transaction(
        context.database,
        () => {
          if (!getMapping(context.database, id))
            throw new AppError(404, "MAPPING_MISSING", "映射不存在");

          const conflict = findMappingIdentity(
            context.database,
            title,
            input.season,
          );

          if (conflict && conflict.id !== id)
            throw new AppError(
              409,
              "MAPPING_EXISTS",
              "此标题和季度的映射已存在",
            );

          return updateMapping(context.database, id, {
            ...input,
            title,
            resolveSeries: input.resolveSeries ?? false,
          });
        },
        "immediate",
      );

    return upsertMapping(
      context.database,
      {
        subjectId: input.subjectId,
        episodeOffset: input.episodeOffset,
        resolveSeries: input.resolveSeries ?? false,
      },
      {
        id: crypto.randomUUID(),
        ...input,
        title,
        createdAt: Date.now(),
      },
    );
  }

  static delete(context: AppContext, id: string) {
    deleteMapping(context.database, id);

    return { ok: true };
  }

  static candidates(context: AppContext) {
    return listPendingCandidates(context.database);
  }

  static resolve(
    context: AppContext,
    id: string,
    subjectId: number | null,
    episodeOffset = 0,
  ) {
    return transaction(
      context.database,
      () => {
        const candidate = getPendingCandidate(context.database, id);

        if (!candidate)
          throw new AppError(404, "CANDIDATE_MISSING", "候选已处理或不存在");

        if (subjectId) {
          MatchingService.save(context, {
            title: candidate.title,
            season: candidate.season,
            subjectId,
            episodeOffset,
          });

          const job = JobsService.get(context, candidate.jobId);

          if (!job)
            throw new AppError(404, "JOB_NOT_FOUND", "原同步任务不存在");

          JobsService.enqueue(context, {
            kind: job.kind,
            dedupeKey: job.dedupeKey,
            payload: job.payload,
            maxAttempts: job.maxAttempts,
          });
        } else {
          const settings = SettingsService.read(context);

          settings.sync.blockedKeywords = [
            ...new Set([...settings.sync.blockedKeywords, candidate.title]),
          ];
          SettingsService.save(context, settings);
        }

        updateCandidateState(context.database, id, {
          state: subjectId ? "confirmed" : "rejected",
        });

        return { ok: true };
      },
      "immediate",
    );
  }
}
