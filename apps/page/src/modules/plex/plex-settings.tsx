import { ConfirmAction } from "@page/components/confirm-action";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@page/components/page-state";
import { Badge } from "@page/components/ui/badge";
import { Button } from "@page/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@page/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@page/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@page/components/ui/field";
import { Input } from "@page/components/ui/input";
import { Switch } from "@page/components/ui/switch";
import { usePlexAccountsQuery } from "@page/hooks/use-plex-queries";
import { useWebhookQuery } from "@page/hooks/use-settings-query";
import { api, unwrap } from "@page/lib/api";
import { copyText } from "@page/lib/clipboard";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

type PlexInput = Parameters<typeof api.api.plex.accounts.post>[0];

const emptyAccount: PlexInput = {
  name: "",
  url: "",
  token: "",
  userName: "",
  enabled: true,
  libraryIds: [],
  cron: "*/15 * * * *",
};

export const PlexSettings = () => {
  const accounts = usePlexAccountsQuery();
  const webhook = useWebhookQuery();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlexInput>(emptyAccount);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inspect = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.api.plex.test.post({
          url: draft.url,
          token: draft.token,
          accountId: editing ?? undefined,
        }),
      ),
    onSuccess: () => toast.success("连接成功"),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...draft,
        libraryIds: draft.libraryIds
          .map((value) => value.trim())
          .filter(Boolean),
      };
      return unwrap(
        await (editing
          ? api.api.plex.accounts({ id: editing }).put(body)
          : api.api.plex.accounts.post(body)),
      );
    },
    onSuccess: () => {
      setOpen(false);
      setDraft(emptyAccount);
      void client.invalidateQueries({ queryKey: ["plex-accounts"] });
      void client.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Plex 账号已保存");
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.plex.accounts({ id }).delete()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["plex-accounts"] });
      void client.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const scan = useMutation({
    mutationFn: async ({ id, full }: { id: string; full: boolean }) =>
      unwrap(await api.api.plex.accounts({ id }).scan.post({ full })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("已安排同步");
    },
    onError: (error) => toast.error(error.message),
  });
  const edit = (id: string | null) => {
    const account = accounts.data?.find((row) => row.id === id);
    setEditing(id);
    setDraft(
      account
        ? {
            name: account.name,
            url: account.url,
            userName: account.userName,
            token: "",
            enabled: account.enabled,
            libraryIds: account.libraryIds,
            cron: account.cron,
          }
        : { ...emptyAccount, libraryIds: [] },
    );
    inspect.reset();
    setOpen(true);
  };
  const patch = (value: Partial<PlexInput>) =>
    setDraft((current) => ({ ...current, ...value }));
  const webhookUrl = webhook.data
    ? window.location.origin + webhook.data.path
    : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Plex 账号</h1>
        <Button onClick={() => edit(null)}>添加账号</Button>
      </header>
      {accounts.error && <ErrorState error={accounts.error} />}
      {accounts.isPending ? (
        <LoadingState />
      ) : accounts.data?.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.data.map((account) => (
            <Card key={account.id}>
              <CardHeader>
                <CardTitle>{account.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  {account.userName} · {account.url}
                </p>
                <Badge variant="secondary" className="self-start">
                  {account.enabled ? "已启用" : "已停用"}
                </Badge>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => edit(account.id)}>
                    编辑
                  </Button>
                  <Button
                    disabled={
                      !account.enabled ||
                      (scan.isPending && scan.variables.id === account.id)
                    }
                    onClick={() => scan.mutate({ id: account.id, full: false })}
                  >
                    立即同步
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!account.enabled || scan.isPending}
                    onClick={() => scan.mutate({ id: account.id, full: true })}
                  >
                    重新核对全部已看
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDeleting(account.id)}
                  >
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="尚未连接 Plex" />
      )}
      <ConfirmAction
        open={Boolean(deleting)}
        title="删除 Plex 账号？"
        description="此账号将停止同步。"
        pending={remove.isPending}
        onOpenChange={(value) => {
          if (!value) setDeleting(null);
        }}
        onConfirm={() => remove.mutateAsync(deleting ?? "")}
      />
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!save.isPending && !inspect.isPending) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "编辑 Plex 账号" : "添加 Plex 账号"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <fieldset
              disabled={save.isPending || inspect.isPending}
              className="min-w-0"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="plex-name">账号名称</FieldLabel>
                  <Input
                    id="plex-name"
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="plex-url">服务器地址</FieldLabel>
                  <Input
                    id="plex-url"
                    type="url"
                    value={draft.url}
                    placeholder="http://192.168.1.10:32400"
                    onChange={(e) => {
                      patch({ url: e.target.value });
                      inspect.reset();
                    }}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="plex-token">Plex Token</FieldLabel>
                  <Input
                    id="plex-token"
                    type="password"
                    autoComplete="new-password"
                    value={draft.token}
                    placeholder={editing ? "留空保留当前 Token" : ""}
                    onChange={(e) => {
                      patch({ token: e.target.value });
                      inspect.reset();
                    }}
                    required={!editing}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="plex-user">Plex 用户名</FieldLabel>
                  <Input
                    id="plex-user"
                    value={draft.userName}
                    onChange={(e) => patch({ userName: e.target.value })}
                    required
                  />
                  <FieldDescription>
                    填写 Token 所属的 Plex 用户名
                  </FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="plex-enabled">启用同步</FieldLabel>
                  <Switch
                    id="plex-enabled"
                    checked={draft.enabled}
                    onCheckedChange={(enabled) => patch({ enabled })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="plex-cron">扫描频率（Cron）</FieldLabel>
                  <Input
                    id="plex-cron"
                    value={draft.cron}
                    onChange={(e) => patch({ cron: e.target.value })}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="plex-libraries">媒体库 ID</FieldLabel>
                  <Input
                    id="plex-libraries"
                    value={draft.libraryIds.join(",")}
                    onChange={(e) =>
                      patch({
                        libraryIds: e.target.value
                          ? e.target.value.split(",")
                          : [],
                      })
                    }
                  />
                  <FieldDescription>
                    多个 ID 用逗号分隔，留空选择全部
                  </FieldDescription>
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    inspect.isPending ||
                    !draft.url.trim() ||
                    (!draft.token.trim() && !editing)
                  }
                  onClick={() => inspect.mutate()}
                >
                  {inspect.isPending ? "连接中…" : "测试连接 / 获取媒体库"}
                </Button>
                {inspect.error && <ErrorState error={inspect.error} />}
                {inspect.data?.libraries.map((library) => (
                  <Field key={library.id} orientation="horizontal">
                    <FieldLabel htmlFor={`plex-library-${library.id}`}>
                      {library.title}
                    </FieldLabel>
                    <Switch
                      id={`plex-library-${library.id}`}
                      checked={draft.libraryIds.includes(library.id)}
                      onCheckedChange={(checked) =>
                        patch({
                          libraryIds: checked
                            ? [...draft.libraryIds, library.id]
                            : draft.libraryIds.filter(
                                (id) => id !== library.id,
                              ),
                        })
                      }
                    />
                  </Field>
                ))}
                <Button type="submit">
                  {save.isPending ? "保存中…" : "保存"}
                </Button>
              </FieldGroup>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      <Card>
        <CardHeader>
          <CardTitle>Plex Webhook</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          {webhook.error && <ErrorState error={webhook.error} />}
          <Input
            aria-label="Plex Webhook 地址"
            readOnly
            value={webhookUrl}
            onFocus={(e) => e.target.select()}
          />
          <Button
            variant="outline"
            disabled={!webhookUrl}
            onClick={async () => {
              try {
                await copyText(webhookUrl);
                toast.success("地址已复制");
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "复制失败，请手动复制",
                );
              }
            }}
          >
            复制地址
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
