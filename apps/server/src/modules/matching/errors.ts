import type { MatchCandidate } from "@server/modules/matching/types";
import { AppError } from "@server/utils/errors";

export class NeedsConfirmation extends AppError {
  constructor(
    public candidates: MatchCandidate[],
    public trace: Record<string, unknown>[],
  ) {
    super(409, "NEEDS_CONFIRMATION", "匹配结果需要人工确认");
  }
}

export class BlockedTitle extends AppError {
  constructor() {
    super(400, "BLOCKED_TITLE", "作品已被屏蔽");
  }
}
