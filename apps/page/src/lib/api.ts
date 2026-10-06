import { treaty } from "@elysiajs/eden";
import { queryClient } from "@page/lib/query-client";
import type { App } from "@server/app";

export const api = treaty<App>(window.location.origin, {
  parseDate: false,
  fetch: { credentials: "same-origin" },
});

export const unwrap = <T>(result: {
  data: T;
  error: unknown;
}): NonNullable<T> => {
  if (result.error) {
    const error = result.error as {
      value?: { message?: string };
      status?: number;
    };

    if (error.status === 401)
      void queryClient.invalidateQueries({ queryKey: ["session"] });

    throw new Error(error.value?.message ?? "请求失败，请稍后重试");
  }

  if (result.data === null || result.data === undefined)
    throw new Error("服务器返回了空数据");

  return result.data;
};
