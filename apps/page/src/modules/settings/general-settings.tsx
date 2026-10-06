import {
  Card,
  CardContent,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@page/components/ui/select";
import { Switch } from "@page/components/ui/switch";
import { Textarea } from "@page/components/ui/textarea";
import type { Settings, UpdateSettings } from "@page/hooks/use-settings-query";

import { useMemo } from "react";

interface Props {
  draft: Settings;
  update: UpdateSettings;
}

const representativeTimezones = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Sao_Paulo",
  "Europe/Paris",
  "Europe/Athens",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Yangon",
  "Asia/Bangkok",
  "Australia/Sydney",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Pacific/Tongatapu",
  "Pacific/Kiritimati",
  "Pacific/Noumea",
  "Pacific/Pago_Pago",
  "Pacific/Marquesas",
  "America/St_Johns",
  "America/Halifax",
  "America/Noronha",
  "Atlantic/Azores",
  "Asia/Tehran",
  "Asia/Kabul",
] as const;

export const GeneralSettings = ({ draft, update }: Props) => {
  const timezones = useMemo(() => {
    const now = new Date();

    const byOffset = new Map<number, ReturnType<typeof timezoneOption>>();

    for (const value of [
      ...representativeTimezones,
      ...Intl.supportedValuesOf("timeZone"),
    ]) {
      const option = timezoneOption(value, now);
      if (!byOffset.has(option.offset)) byOffset.set(option.offset, option);
    }

    // Keep the saved region without adding a second option for its UTC offset.
    const selected = timezoneOption(draft.scheduler.timezone, now);
    byOffset.set(selected.offset, selected);

    return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
  }, [draft.scheduler.timezone]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>匹配与同步</CardTitle>
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
              <FieldDescription>每行一个关键词</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>同步与数据源</CardTitle>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="timezone">时区</FieldLabel>
              <Select
                value={draft.scheduler.timezone}
                onValueChange={(timezone) => update("scheduler", { timezone })}
              >
                <SelectTrigger id="timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  <SelectGroup>
                    {timezones.map(({ value, label }) => (
                      <SelectItem key={value} value={value} textValue={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
              <FieldLabel htmlFor="data-enabled">使用标题索引</FieldLabel>
              <Switch
                id="data-enabled"
                checked={draft.bangumi.dataEnabled}
                onCheckedChange={(dataEnabled) =>
                  update("bangumi", { dataEnabled })
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="data-url">标题索引地址</FieldLabel>
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
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </>
  );
};

const timezoneOption = (value: string, date: Date) => {
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";

  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  const offset = match
    ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1)
    : 0;
  const label = name === "GMT" ? "UTC+00:00" : name.replace("GMT", "UTC");

  return { value, offset, label: `(${label}) ${value}` };
};
