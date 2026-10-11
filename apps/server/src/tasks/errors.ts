import { AppError } from "@server/utils/errors";

export class ScanIncomplete extends AppError {
  constructor(
    public retryable: boolean,
    public retryAfter: number,
  ) {
    super(
      409,
      "SCAN_INCOMPLETE",
      "扫描未完整完成，请查看扫描问题；有效项目已入队",
    );
  }
}
