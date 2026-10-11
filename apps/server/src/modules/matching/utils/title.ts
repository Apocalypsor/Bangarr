/*
 * Title matching rules adapted from SanaeMio/Bangumi-syncer (8155715).
 * https://github.com/SanaeMio/Bangumi-syncer
 *
 * MIT License
 * Copyright (c) 2024 SanaeMio
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export const titleNames = (title: string, originalTitle: string) => [
  ...new Set(
    [title, originalTitle].map((value) => value.trim()).filter(Boolean),
  ),
];

export const normalizeTitle = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /\{(?:tmdb|tvdb|imdb|bangumi)[^}]*\}|\[(?:tmdb|tvdb|imdb|bangumi)[^\]]*\]/gi,
      "",
    )
    .replace(/[\p{P}\p{S}\s]/gu, "");

// The reference keeps catalog season stripping separate from API query variants.
export const catalogTitle = (title: string, season: number) => {
  if (season <= 1) return title;
  for (const pattern of [
    /\s*第?\s*\d+\s*期?[話话集]?$/,
    /\s*Season\s*\d+$/i,
    /\s*S\d+$/i,
    /\s*\d+$/,
    /\s*II+$/,
    /\s*第?\s*\d+\s*[期季]$/,
  ])
    title = title.replace(pattern, "");
  return title;
};

export const normalizeSearchTitle = (title: string) => {
  let cleaned = [...title]
    .map((char) => searchPunctuation[char] ?? char)
    .join("");
  for (const pattern of [
    /\[[^[\]]*\]/g,
    /\((?:1080|2160|720|480)[pP]?\)/g,
    /\((?:HEVC|x264|x265|AVC|AAC|FLAC|10bit|BD|BDRip|WEBRip)\)/g,
    /\b(?:1080p|2160p|720p|480p|HEVC|x264|x265|AVC|AAC|FLAC|10bit|BDRip|WEBRip|WEB-DL|BluRay|Blu-Ray|60fps|120fps|24fps|30fps)\b/gi,
    /\.(?:mp4|mkv|avi|mov|flv|ts|m4v)$/gi,
  ])
    cleaned = cleaned.replace(pattern, " ");
  return cleaned
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-_·.:;, ]+|[-_·.:;, ]+$/g, "")
    .trim();
};

export const seasonNumbers = (value: string) => {
  const numbers = new Set<number>();

  for (const match of value
    .normalize("NFKC")
    .matchAll(
      /第\s*([0-9一二三四五六七八九十百]+)\s*[季期]|(?:season\s*(\d+))|(?:(\d+)(?:st|nd|rd|th)\s*season)/gi,
    )) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const parsed = /^\d+$/.test(raw) ? Number(raw) : chineseNumber(raw);

    if (parsed > 0) numbers.add(parsed);
  }

  return numbers;
};

// Bangumi-syncer 8155715: bangumi_archive/_title_normalize.py.
export const stripSeasonSuffix = (title: string) => {
  const value = title.normalize("NFKC").trim();
  for (const pattern of seasonSuffixes) {
    const match = pattern.exec(value);
    if (match && value.slice(0, match.index).trim().length >= 2)
      return value.slice(0, match.index).trim();
  }
  return value;
};

export const searchVariants = (title: string, originalTitle: string) => {
  const originals = [originalTitle, title].map((name) =>
    name.normalize("NFKC"),
  );
  const stripped = originals.map(stripSeasonSuffix);
  const variants = new Set([
    ...originals,
    ...stripped,
    ...originals.map(coreTitle),
  ]);
  for (const name of [...originals, ...stripped]) {
    const unwrapped = unwrapTitle(name);
    if (unwrapped !== name) {
      variants.add(unwrapped);
      variants.add(coreTitle(unwrapped));
    }
  }
  const bases = stripped.flatMap((name) => [name, unwrapTitle(name)]);
  for (const name of bases) {
    const main = mainTitle(name);
    if (main.length >= 4) variants.add(main);
  }
  for (const name of [
    ...bases,
    ...bases.map(mainTitle).filter((name) => name.length >= 4),
  ])
    if (name && !mediaPrefixes.some((prefix) => name.startsWith(prefix)))
      for (const prefix of mediaPrefixes) variants.add(`${prefix}${name}`);
  return [...variants].filter((name) => name.trim());
};

// RapidFuzz fuzz.ratio is normalized Indel similarity, not Levenshtein distance.
export const titleRatio = (left: string, right: string) => {
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

export const apiTitleScore = (
  title: string,
  original: string,
  aliases: string[],
) => {
  const names = [
    ...new Set([title, original || title].map(normalizeMatchTitle)),
  ];
  const cores = names.map(stripMediaSuffix);
  let best = 0;

  for (const candidate of new Set(
    aliases.filter(Boolean).map(normalizeMatchTitle),
  )) {
    const core = stripMediaSuffix(candidate);
    let score = Math.max(
      ...names.map((name, index) => {
        const queryCore = cores[index] ?? name;
        const coreMatch =
          name !== queryCore &&
          queryCore.length >= 2 &&
          (containsEither(queryCore, candidate) ||
            containsEither(queryCore, core));
        return Math.max(
          titleRatio(name, candidate),
          partialRatio(name, candidate) * 0.7,
          coreMatch ? 0.9 : 0,
        );
      }),
    );
    if (
      cores[0] !== names[0] &&
      core !== candidate &&
      !cores.some(
        (query) =>
          titleRatio(query, core) >= 0.4 || containsEither(query, core),
      )
    )
      score = Math.min(score, 0.4);

    best = Math.max(best, score);
    if (best === 1) return best;
  }

  return best;
};

const normalizeMatchTitle = (title: string) =>
  title
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/年番|外传|特别篇|总集篇/g, "")
    .replace(/番外$/, "");

const stripMediaSuffix = (title: string) => {
  const core = title.replace(/(?:动画版|真人版|电影版|TV版)$/, "");
  return core.length >= 2 ? core : title;
};

const coreTitle = (title: string) =>
  stripMediaSuffix(normalizeMatchTitle(title));

const containsEither = (a: string, b: string) =>
  Boolean(a && b && (a.includes(b) || b.includes(a)));

const partialRatio = (left: string, right: string) => {
  const a = [...left],
    b = [...right];
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.length || !long.length) return 0;
  if (long.join("").includes(short.join(""))) return 1;

  const alignmentScore = (query: string[], text: string[]) => {
    let best = 0;
    const title = query.join("");
    for (let start = 1 - query.length; start < text.length; start++)
      best = Math.max(
        best,
        titleRatio(
          title,
          text.slice(Math.max(0, start), start + query.length).join(""),
        ),
      );
    return best;
  };
  // RapidFuzz tries both alignments when neither input is shorter.
  return Math.max(
    alignmentScore(short, long),
    short.length === long.length ? alignmentScore(long, short) : 0,
  );
};

const unwrapTitle = (title: string) => {
  const value = title.trim();
  return [
    ["「", "」"],
    ["『", "』"],
    ["【", "】"],
    ["《", "》"],
    ["〈", "〉"],
    ["[", "]"],
    ["(", ")"],
  ].some(
    ([open, close]) =>
      value.startsWith(open ?? "") && value.endsWith(close ?? ""),
  )
    ? value.slice(1, -1).trim()
    : value;
};

const mainTitle = (title: string) => {
  for (const separator of ["：", ":", "～", "〜", "~", "—", "－", "-"])
    if (
      title.indexOf(separator) > 0 &&
      (title.split(separator)[0]?.trim().length ?? 0) >= 2
    )
      return title.split(separator)[0]?.trim() ?? "";
  return title;
};

const searchPunctuation: Record<string, string> = {
  "：": ":",
  "；": ";",
  "，": ",",
  "。": ".",
  "？": "?",
  "！": "!",
  "（": "(",
  "）": ")",
  "【": "[",
  "】": "]",
  "《": "<",
  "》": ">",
  "「": "'",
  "」": "'",
  "『": "'",
  "』": "'",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "～": "~",
  "・": "·",
  "･": "·",
  "—": "-",
  "–": "-",
  "―": "-",
};

const mediaPrefixes = ["劇場版 ", "剧场版 ", "映画 ", "映画版 "];
const seasonSuffixes = [
  /\s*S\s*\d+\s*E\s*\d+.*$/i,
  /\s*第\s*\d+\s*[期季].*$/,
  /\s*第\s*[一二三四五六七八九十]+\s*[期季].*$/,
  /\s*[一二三四五六七八九十]+\s*[期季].*$/,
  /\s*season\s*\d+.*$/i,
  /\s*\d+(?:st|nd|rd|th)?\s*season.*$/i,
  /\s*(?:上|下)半.*$/,
  /\s*第\s*\d+\s*部分.*$/,
  /\s*第\s*[\d一二三四五六七八九十]+\s*部$/,
  /\s+[IVX]{2,}$/,
  /\s+(?:v|ver|version|vol)\.?\s*\d+$/i,
  /\s*(?:番外篇|番外|续集|續集|续|續|前传|前傳|外传|外傳|特别篇|完結編|完結篇|前編|前篇|後編|後篇|続編|続篇)$/,
  /\s*Part\s*\d*$/i,
];

const chineseNumber = (value: string) => {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (value.includes("十")) {
    const [tens, ones] = value.split("十");

    return (
      (tens ? (digits[tens] ?? 0) : 1) * 10 + (ones ? (digits[ones] ?? 0) : 0)
    );
  }

  return digits[value] ?? 0;
};
