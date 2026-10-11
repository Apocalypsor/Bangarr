import type { BangumiClient } from "@server/clients/bangumi";
import type { BangumiSubject } from "@server/clients/bangumi/types";
import type { PlexItem } from "@server/clients/plex/types";
import { CatalogStore } from "@server/db/catalog";
import { transaction } from "@server/db/client";
import {
  deleteMapping,
  findMappingIdentity,
  findSeasonMappings,
  getMapping,
  getPendingCandidate,
  listMappings,
  listPendingCandidateDetails,
  listPendingCandidates,
  updateCandidateState,
  updateMapping,
  upsertMapping,
} from "@server/db/matching";
import { JobsService } from "@server/modules/jobs/service";
import {
  BlockedTitle,
  NeedsConfirmation,
} from "@server/modules/matching/errors";
import type {
  MappingInput,
  MatchCandidate,
  MatchResult,
} from "@server/modules/matching/types";
import {
  conflictingEpisodeDate,
  currentTitleDate,
  episodeDateConflicts,
  findEpisode,
  isMovie,
  mergeSubject,
  selectCandidate,
  subjectAliases,
} from "@server/modules/matching/utils/candidates";
import type { EpisodeSegment } from "@server/modules/matching/utils/episodes";
import {
  findCumulativeEpisode,
  findDatedEpisode,
  findLocalEpisode,
  findMergedSeasonEpisode,
  groupSeasonSegments,
  orderSegments,
} from "@server/modules/matching/utils/episodes";
import {
  normalizeTitle,
  seasonNumbers,
  similarity,
  titleNames,
} from "@server/modules/matching/utils/title";
import type { Settings } from "@server/modules/settings/model";
import { SettingsService } from "@server/modules/settings/service";
import type { AppContext } from "@server/types";
import { AppError } from "@server/utils/errors";

type PendingCandidateDetail = ReturnType<
  typeof listPendingCandidateDetails
>[number];
type CandidateGroup = PendingCandidateDetail["candidate"] & {
  taskCount: number;
  tasks: (Omit<PendingCandidateDetail, "candidate"> & { jobId: string })[];
};

export abstract class MatchingService {
  static async match(
    context: Pick<AppContext, "database">,
    item: PlexItem,
    api: BangumiClient,
    config: Settings,
  ): Promise<MatchResult> {
    const trace: Record<string, unknown>[] = [];
    const rules = findSeasonMappings(context.database, item.season);

    const names = titleNames(item.title, item.originalTitle);

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
        // As in Bangumi-syncer's custom mapping step, a later-season ID is
        // an entry into the relation chain, not a promise that it owns every ep.
        !mapping.resolveSeries &&
          (item.season <= 1 || mapping.episodeOffset !== 0),
        trace,
        !mapping.resolveSeries,
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
    const seasonMatched =
      first.dateMatched === true ||
      (explicit.size === 1 && explicit.has(item.season));

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
  ): Promise<MatchCandidate> {
    const names = titleNames(item.title, item.originalTitle);

    const subjects = new Map<number, BangumiSubject>();

    const local = config.bangumi.dataEnabled
      ? new CatalogStore(context.database.path).search(
          names,
          Boolean(item.releaseDate),
        )
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

    const datedLocalMatch = local.some(
      (subject) =>
        exactIds.has(subject.id) &&
        subject.date &&
        currentTitleDate(subject.date, item.releaseDate),
    );
    if (exactIds.size !== 1 || (item.releaseDate && !datedLocalMatch)) {
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

    const selected = selectCandidate(
      scored,
      subjects,
      names,
      item.releaseDate,
      config.sync,
    );
    trace.push(...selected.trace);
    if (!selected.candidate)
      throw new NeedsConfirmation(scored.slice(0, 10), trace);
    return selected.candidate;
  }

  static async resolveEpisode(
    _context: Pick<AppContext, "database">,
    item: PlexItem,
    api: BangumiClient,
    subjectId: number,
    seasonMatched: boolean,
    trace: Record<string, unknown>[],
    manualSubject = false,
  ): Promise<{
    subjectId: number;
    episodeId: number;
  }> {
    if (item.episode > 9999 || item.season > 100 || item.episode < 0)
      throw new AppError(400, "EPISODE_RANGE", "季度或集数超出允许范围");

    const type = item.season === 0 ? 1 : 0;
    const episodes = await api.episodes(subjectId, type);

    if (item.mediaType === "movie") {
      const episode = [...episodes].sort((a, b) => a.sort - b.sort)[0];

      if (!episode && manualSubject)
        throw new AppError(
          409,
          "MAPPED_EPISODE_MISSING",
          `Bangumi 条目 ${subjectId} 没有正片章节，请检查所选条目`,
        );

      if (!episode)
        throw new NeedsConfirmation(
          [],
          [...trace, { step: "episode", reason: "电影没有正片章节" }],
        );

      return { subjectId, episodeId: episode.id };
    }

    // The reference resolver does not treat E00 as a positive local episode.
    // Keep it pending rather than substituting another chapter.
    if (item.episode === 0) {
      const subject = await api.subject(subjectId);
      throw new NeedsConfirmation(
        [
          {
            id: subject.id,
            name: subject.name,
            nameCn: subject.name_cn,
            date: subject.date ?? "",
            score: 0,
            source: "episode",
          },
        ],
        [
          ...trace,
          { step: "episode", reason: "第 0 集需要确认对应条目与集数偏移" },
        ],
      );
    }

    if (manualSubject && seasonMatched) {
      const episode = findLocalEpisode(episodes, item.episode);

      if (episode) {
        trace.push({
          step: "episode",
          method: "manual",
          subjectId,
          episodeId: episode.id,
        });
        return { subjectId, episodeId: episode.id };
      }

      trace.push({ step: "episode", method: "mapped-subject-miss", subjectId });
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

    const conflictingDate = episodeDateConflicts(selected, item.releaseDate);

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
            .filter(
              (ep) =>
                ep.airdate === item.releaseDate &&
                (item.episode !== 0 || ep.sort === 0),
            )
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

    // Include the selected part as well as its same-season relations: a manual
    // mapping may enter at either cour. Only use an unambiguous season chain.
    const nearDate =
      item.season > 1 && targets
        ? findDatedEpisode(targets, item.episode, item.releaseDate)
        : undefined;

    if (nearDate) {
      trace.push({ step: "episode", method: "chapter-airdate", ...nearDate });

      return { subjectId: nearDate.subjectId, episodeId: nearDate.episodeId };
    }

    const cumulative =
      targets && nearDate !== null
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

    if (nearDate !== null && (item.season <= 1 || exceedsSeason)) {
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
    const groups = new Map<string, CandidateGroup>();

    for (const { candidate, ...detail } of listPendingCandidateDetails(
      context.database,
    )) {
      const key = JSON.stringify([candidate.title, candidate.season]);
      const group = groups.get(key);

      if (!group) {
        groups.set(key, {
          ...candidate,
          taskCount: 1,
          tasks: [{ ...detail, jobId: candidate.jobId }],
        });
        continue;
      }

      group.taskCount++;
      group.tasks.push({ ...detail, jobId: candidate.jobId });
      const choiceIds = new Set(group.choices.map((choice) => choice.id));
      for (const choice of candidate.choices) {
        if (!choiceIds.has(choice.id)) {
          group.choices.push(choice);
          choiceIds.add(choice.id);
        }
      }
    }

    return [...groups.values()].map((group) => ({
      ...group,
      tasks: group.tasks.sort(
        (a, b) =>
          (a.episode ?? Infinity) - (b.episode ?? Infinity) ||
          a.jobId.localeCompare(b.jobId),
      ),
    }));
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

        const related = listPendingCandidates(
          context.database,
          candidate.title,
          subjectId ? candidate.season : undefined,
        );

        if (subjectId) {
          MatchingService.save(context, {
            title: candidate.title,
            season: candidate.season,
            subjectId,
            episodeOffset,
          });

          for (const jobId of new Set(related.map((row) => row.jobId))) {
            const job = JobsService.get(context, jobId);

            if (!job)
              throw new AppError(
                404,
                "JOB_NOT_FOUND",
                "无法重试此匹配，请重新扫描 Plex",
              );

            JobsService.requeue(context, job);
          }
        } else {
          const settings = SettingsService.read(context);

          settings.sync.blockedKeywords = [
            ...new Set([...settings.sync.blockedKeywords, candidate.title]),
          ];
          SettingsService.save(context, settings);
        }

        for (const row of related) {
          updateCandidateState(context.database, row.id, {
            state: subjectId ? "confirmed" : "rejected",
          });
        }

        return { ok: true };
      },
      "immediate",
    );
  }
}
