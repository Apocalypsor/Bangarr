import { ErrorState } from "@page/components/page-state";
import { Button } from "@page/components/ui/button";
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
import { Switch } from "@page/components/ui/switch";
import { usePlexLibrariesQuery } from "@page/hooks/use-plex-queries";
import type { Settings, UpdateSettings } from "@page/hooks/use-settings-query";
import { useWebhookQuery } from "@page/hooks/use-settings-query";
import { api, unwrap } from "@page/lib/api";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  draft: Settings;
  update: UpdateSettings;
  dirty: boolean;
  tokenConfigured: boolean;
}

export const PlexSettings = ({
  draft,
  update,
  dirty,
  tokenConfigured,
}: Props) => {
  const inspect = usePlexLibrariesQuery();

  const webhook = useWebhookQuery();

  const scan = useMutation({
    mutationFn: async (full: boolean) =>
      unwrap(await api.api.plex.scan.post({ full })),
    onSuccess: () => toast.success("已安排同步"),
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>媒体服务器</CardTitle>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="plex-enabled">定时同步</FieldLabel>
              <Switch
                id="plex-enabled"
                checked={draft.plex.enabled}
                onCheckedChange={(enabled) => update("plex", { enabled })}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="plex-url">服务器地址</FieldLabel>
              <Input
                id="plex-url"
                type="url"
                placeholder="http://192.168.1.10:32400"
                value={draft.plex.url}
                onChange={(e) => update("plex", { url: e.target.value })}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="plex-token">Plex Token</FieldLabel>
              <Input
                id="plex-token"
                type="password"
                autoComplete="new-password"
                placeholder={
                  tokenConfigured ? "已保存，留空保留" : "X-Plex-Token"
                }
                value={draft.plex.token}
                onChange={(e) => update("plex", { token: e.target.value })}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="plex-user">Plex 用户名</FieldLabel>
              <Input
                id="plex-user"
                value={draft.plex.userName}
                onChange={(e) => update("plex", { userName: e.target.value })}
              />
              <FieldDescription>填写 Token 所属的 Plex 用户名</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="plex-cron">扫描频率（Cron）</FieldLabel>
              <Input
                id="plex-cron"
                value={draft.plex.cron}
                onChange={(e) => update("plex", { cron: e.target.value })}
              />
              <FieldDescription>
                例如 */15 * * * * 表示每 15 分钟
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="plex-libraries">媒体库 ID</FieldLabel>
              <Input
                id="plex-libraries"
                value={draft.plex.libraryIds.join(",")}
                onChange={(e) =>
                  update("plex", {
                    libraryIds: e.target.value ? e.target.value.split(",") : [],
                  })
                }
              />
              <FieldDescription>
                多个 ID 用逗号分隔，留空选择全部
              </FieldDescription>
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                type="button"
                disabled={dirty || inspect.isFetching}
                onClick={() => void inspect.refetch()}
              >
                {inspect.isFetching ? "连接中…" : "测试连接"}
              </Button>
              <Button
                type="button"
                disabled={dirty || scan.isPending}
                onClick={() => scan.mutate(false)}
              >
                立即同步
              </Button>
              <Button
                variant="outline"
                type="button"
                disabled={dirty || scan.isPending}
                onClick={() => scan.mutate(true)}
              >
                重新核对全部已看
              </Button>
            </div>
            {dirty ? (
              <p className="text-sm text-muted-foreground">请先保存修改</p>
            ) : null}
            {inspect.error ? <ErrorState error={inspect.error} /> : null}
            {inspect.data ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  已连接 Plex {inspect.data.server.version}
                </p>
                {inspect.data.libraries.map((library) => (
                  <Field key={library.id} orientation="horizontal">
                    <FieldLabel htmlFor={`library-${library.id}`}>
                      {library.title} · {library.id}
                    </FieldLabel>
                    <Switch
                      id={`library-${library.id}`}
                      checked={draft.plex.libraryIds.includes(library.id)}
                      onCheckedChange={(checked) =>
                        update("plex", {
                          libraryIds: checked
                            ? [...draft.plex.libraryIds, library.id]
                            : draft.plex.libraryIds.filter(
                                (id) => id !== library.id,
                              ),
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            ) : null}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plex Webhook</CardTitle>
        </CardHeader>

        <CardContent>
          <Input
            aria-label="Plex Webhook 地址"
            readOnly
            type="password"
            value={
              webhook.data ? window.location.origin + webhook.data.path : ""
            }
          />
          <Button
            variant="outline"
            className="mt-3"
            disabled={!webhook.data}
            onClick={async () => {
              if (webhook.data) {
                await navigator.clipboard.writeText(
                  window.location.origin + webhook.data.path,
                );

                toast.success("Webhook 地址已复制");
              }
            }}
          >
            复制地址
          </Button>
        </CardContent>
      </Card>
    </>
  );
};
