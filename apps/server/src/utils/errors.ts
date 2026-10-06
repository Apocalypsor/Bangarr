export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RemoteError extends AppError {
  constructor(
    public service: string,
    public remoteStatus: number,
    public retryAfter = 0,
  ) {
    super(502, "REMOTE_ERROR", `${service} 请求失败（HTTP ${remoteStatus}）`);
  }
}
