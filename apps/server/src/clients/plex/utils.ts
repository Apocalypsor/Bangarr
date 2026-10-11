import type { PlexContainer, PlexItem } from "@server/clients/plex/types";
import { AppError } from "@server/utils/errors";
import { XMLParser } from "fast-xml-parser";

export const parsePlexContainer = (text: string): PlexContainer => {
  try {
    let parsed: unknown;

    if (text.trimStart().startsWith("<")) {
      // 不解析外部实体/DTD，固定集合为数组，包括只有一个元素时。
      if (/<!DOCTYPE|<!ENTITY/i.test(text))
        throw new Error("DTD is unsupported");

      parsed = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        parseAttributeValue: false,
        processEntities: false,
        isArray: (name) => ["Directory", "Video"].includes(name),
      }).parse(text);
    } else parsed = JSON.parse(text);

    if (!isObject(parsed) || !isObject(parsed.MediaContainer))
      throw new Error("Invalid container");

    const container = parsed.MediaContainer;

    if (container.Video !== undefined) container.Metadata = container.Video;

    return container;
  } catch {
    throw new AppError(
      502,
      "PLEX_INVALID_RESPONSE",
      "Plex 返回了无法识别的数据",
    );
  }
};

export const parsePlexItem = (row: Record<string, unknown>): PlexItem => {
  const movie = row.type === "movie";

  if (!movie && row.type !== "episode")
    throw new AppError(400, "PLEX_UNSUPPORTED_TYPE", "只支持 Plex 剧集和电影");

  const title = plexText(movie ? row.title : row.grandparentTitle).trim();
  const season = movie ? 1 : plexNumber(row.parentIndex);
  const episode = movie ? 1 : plexNumber(row.index);

  if (
    !title ||
    !Number.isInteger(season) ||
    season < 0 ||
    !Number.isInteger(episode) ||
    episode < 0
  )
    throw new AppError(
      400,
      "PLEX_INVALID_ITEM",
      "Plex 项目缺少标题，或季度、集数无效",
    );

  return {
    ratingKey: plexText(row.ratingKey),
    title,
    originalTitle: movie ? plexText(row.originalTitle).trim() : "",
    season,
    episode,
    mediaType: movie ? "movie" : "episode",
    releaseDate: plexText(row.originallyAvailableAt),
    viewCount: plexNumber(row.viewCount ?? 0),
    lastViewedAt: row.lastViewedAt ? plexNumber(row.lastViewedAt) : null,
  };
};

export const plexText = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export const plexNumber = (value: unknown) =>
  typeof value === "number" ||
  (typeof value === "string" && value.trim() !== "")
    ? Number(value)
    : Number.NaN;

export const containerRows = (
  container: PlexContainer,
  key: string,
): Record<string, unknown>[] => {
  const value = container[key];

  if (
    value === undefined &&
    (Number(container.size) === 0 || Number(container.totalSize) === 0)
  )
    return [];

  if (!Array.isArray(value) || !value.every(isObject))
    throw new AppError(502, "PLEX_INVALID_LIST", "Plex 返回了无效列表");

  return value;
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
