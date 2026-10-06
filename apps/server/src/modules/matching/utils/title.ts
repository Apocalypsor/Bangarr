export const normalizeTitle = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /\{(?:tmdb|tvdb|imdb|bangumi)[^}]*\}|\[(?:tmdb|tvdb|imdb|bangumi)[^\]]*\]/gi,
      "",
    )
    .replace(/[\p{P}\p{S}\s]/gu, "");

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

export const baseTitle = (value: string) =>
  normalizeTitle(
    value.replace(
      /第\s*[0-9一二三四五六七八九十百]+\s*[季期]|season\s*\d+|\d+(?:st|nd|rd|th)\s*season/gi,
      "",
    ),
  );

export const similarity = (a: string, b: string) => {
  const left = [...normalizeTitle(a)];
  const right = [...normalizeTitle(b)];

  if (!left.length || !right.length) return 0;

  const previous = right.map((_, index) => index + 1);

  previous.unshift(0);

  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0] ?? 0;

    previous[0] = i;

    for (let j = 1; j <= right.length; j++) {
      const above = previous[j] ?? 0;

      previous[j] = Math.min(
        above + 1,
        (previous[j - 1] ?? 0) + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }

  return (
    1 - (previous[right.length] ?? 0) / Math.max(left.length, right.length)
  );
};

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
