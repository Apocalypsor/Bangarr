import { AppError, RemoteError } from "@server/utils/errors";

export type HttpTransport = (request: Request) => Promise<Response>;

export class HttpClient {
  constructor(
    private baseUrl: string,
    private service: string,
    private headers: Record<string, string> = {},
    private transport: HttpTransport = fetch,
  ) {}

  async request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      params?: Record<string, string | number>;
      signal?: AbortSignal;
    } = {},
  ) {
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`,
    );

    for (const [key, value] of Object.entries(options.params ?? {}))
      url.searchParams.set(key, String(value));

    const controller = AbortSignal.timeout(30000);

    try {
      const response = await this.transport(
        new Request(url.toString(), {
          method: options.method ?? "GET",
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Bangarr/2.0 (https://github.com/Apocalypsor/Bangarr)",
            ...this.headers,
            ...(options.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          redirect: "error",
          signal: options.signal
            ? AbortSignal.any([options.signal, controller])
            : controller,
        }),
      );

      if (!response.ok) {
        const retryHeader = response.headers.get("Retry-After") ?? "";
        const seconds = Number(retryHeader);

        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryHeader) - Date.now();

        throw new RemoteError(
          this.service,
          response.status,
          Math.max(0, Math.min(3600000, delay || 0)),
        );
      }

      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;

      // 不向日志/前端传递含 URL、请求头或 token 的第三方异常。
      throw new AppError(
        502,
        "REMOTE_UNREACHABLE",
        `${this.service} 暂时无法连接`,
      );
    }
  }

  async json<T>(
    path: string,
    options: Parameters<HttpClient["request"]>[1] = {},
  ): Promise<T> {
    const response = await this.request(path, options);

    if (response.status === 204) return undefined as T;

    try {
      return (await response.json()) as T;
    } catch {
      throw new AppError(
        502,
        "REMOTE_INVALID_RESPONSE",
        `${this.service} 返回了无法识别的数据`,
      );
    }
  }
}
