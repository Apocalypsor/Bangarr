import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@page/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@page/components/ui/field";
import { Input } from "@page/components/ui/input";
import { Switch } from "@page/components/ui/switch";
import { Textarea } from "@page/components/ui/textarea";
import type { Settings, UpdateSettings } from "@page/hooks/use-settings-query";

interface Props {
  draft: Settings;
  update: UpdateSettings;
}

export const GeneralSettings = ({ draft, update }: Props) => {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>匹配与同步</CardTitle>
          <CardDescription>
            修改后用于后续任务，不会自动重写已有进度。
          </CardDescription>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="confidence">最低匹配置信度</FieldLabel>
              <Input
                id="confidence"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={draft.sync.confidence}
                onChange={(e) =>
                  update("sync", { confidence: Number(e.target.value) })
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="margin">候选最低领先幅度</FieldLabel>
              <Input
                id="margin"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={draft.sync.minMargin}
                onChange={(e) =>
                  update("sync", { minMargin: Number(e.target.value) })
                }
              />
            </Field>

            {(
              [
                ["realAction", "包含三次元作品"],
                ["movieWatching", "电影播放开始标记在看"],
                ["movieCompleted", "电影完成后整部标记看过"],
                ["animeCompleted", "所有正片完成后整部标记看过"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} orientation="horizontal">
                <FieldLabel htmlFor={key}>{label}</FieldLabel>
                <Switch
                  id={key}
                  checked={draft.sync[key]}
                  onCheckedChange={(checked) =>
                    update("sync", { [key]: checked })
                  }
                />
              </Field>
            ))}

            <Field>
              <FieldLabel htmlFor="blocked">屏蔽关键词</FieldLabel>
              <Textarea
                id="blocked"
                value={draft.sync.blockedKeywords.join("\n")}
                onChange={(e) =>
                  update("sync", {
                    blockedKeywords: e.target.value
                      ? e.target.value.split("\n")
                      : [],
                  })
                }
              />
              <FieldDescription>
                每行一个，自定义映射优先于屏蔽规则。
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>任务与数据源</CardTitle>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="timezone">时区</FieldLabel>
              <Input
                id="timezone"
                value={draft.scheduler.timezone}
                onChange={(e) =>
                  update("scheduler", { timezone: e.target.value })
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="attempts">最大尝试次数</FieldLabel>
              <Input
                id="attempts"
                type="number"
                min={1}
                max={50}
                value={draft.scheduler.maxAttempts}
                onChange={(e) =>
                  update("scheduler", {
                    maxAttempts: Number(e.target.value),
                  })
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="api-url">Bangumi API 地址</FieldLabel>
              <Input
                id="api-url"
                type="url"
                value={draft.bangumi.apiUrl}
                onChange={(e) => update("bangumi", { apiUrl: e.target.value })}
              />
            </Field>

            <Field orientation="horizontal">
              <FieldLabel htmlFor="data-enabled">启用 bangumi-data</FieldLabel>
              <Switch
                id="data-enabled"
                checked={draft.bangumi.dataEnabled}
                onCheckedChange={(dataEnabled) =>
                  update("bangumi", { dataEnabled })
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="data-url">bangumi-data 地址</FieldLabel>
              <Input
                id="data-url"
                type="url"
                value={draft.bangumi.dataUrl}
                onChange={(e) => update("bangumi", { dataUrl: e.target.value })}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="data-refresh-days">
                标题索引更新间隔（天）
              </FieldLabel>
              <Input
                id="data-refresh-days"
                type="number"
                min={1}
                max={365}
                value={draft.bangumi.dataRefreshDays}
                onChange={(event) =>
                  update("bangumi", {
                    dataRefreshDays: Number(event.target.value),
                  })
                }
              />
              <FieldDescription>
                启用后首次自动导入，默认每 7
                天更新；失败时保留旧索引并在稍后重试。
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </>
  );
};
