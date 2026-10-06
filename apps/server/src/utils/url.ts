import { AppError } from "@server/utils/errors";

export const validateHttpUrl = (input: string) => {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new AppError(400, "INVALID_URL", "请输入有效的 HTTP(S) 地址");
  }

  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AppError(
      400,
      "INVALID_URL",
      "服务器地址不能包含凭据、查询参数或片段",
    );
  }

  return url;
};
