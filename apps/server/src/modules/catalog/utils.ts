import { AppError } from "@server/utils/errors";

export const limitedText = async (response: Response, maxBytes: number) => {
  if (!response.body)
    throw new AppError(502, "EMPTY_DOWNLOAD", "数据源没有返回内容");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > maxBytes)
        throw new AppError(502, "DOWNLOAD_TOO_LARGE", "数据源内容超过限制");

      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }

  return Buffer.concat(chunks).toString("utf8");
};
