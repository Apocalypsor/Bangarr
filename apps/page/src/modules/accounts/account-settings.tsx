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
  CardDescription,
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
import { useAccountsQuery } from "@page/hooks/use-accounts-query";
import { api, unwrap } from "@page/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const AccountSettings = () => {
  const [deleteAccount, setDeleteAccount] = useState<{
    id: string;
    username: string;
  } | null>(null);

  const client = useQueryClient();

  const accounts = useAccountsQuery();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [users, setUsers] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isPrivate, setPrivate] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        token,
        plexUsers: users
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        enabled,
        private: isPrivate,
      };

      return unwrap(
        await (editing
          ? api.api.accounts({ id: editing }).put(body)
          : api.api.accounts.post(body)),
      );
    },
    onSuccess: () => {
      setOpen(false);
      setToken("");
      void client.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Bangumi 账号已保存");
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.accounts({ id }).delete()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const edit = (id: string | null) => {
    const account = accounts.data?.find((row) => row.id === id);
    setEditing(id);
    setToken("");
    setUsers(account?.plexUsers.join(",") ?? "");
    setEnabled(account?.enabled ?? true);
    setPrivate(account?.private ?? false);
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <ConfirmAction
        open={Boolean(deleteAccount)}
        title="删除账号连接？"
        description={`将移除 ${deleteAccount?.username ?? ""} 的连接配置，Bangumi 收藏会保留。`}
        pending={remove.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteAccount(null);
        }}
        onConfirm={() => remove.mutateAsync(deleteAccount?.id ?? "")}
      />

      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Bangumi 账号
          </h1>
        </div>
        <Button onClick={() => edit(null)}>
          <Plus data-icon="inline-start" />
          添加账号
        </Button>
      </header>

      {accounts.error ? (
        <ErrorState error={accounts.error} />
      ) : accounts.isPending ? (
        <LoadingState />
      ) : accounts.data.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.data.map((account) => (
            <Card key={account.id}>
              <CardHeader>
                <CardTitle>{account.nickname || account.username}</CardTitle>
                <CardDescription>@{account.username}</CardDescription>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <div className="flex gap-2">
                  <Badge variant="secondary">
                    {account.enabled ? "已启用" : "已停用"}
                  </Badge>
                  {account.plexUsers.map((user) => (
                    <Badge key={user} variant="outline">
                      {user}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => edit(account.id)}>
                    编辑绑定
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`删除 ${account.username}`}
                    disabled={remove.isPending}
                    onClick={() =>
                      setDeleteAccount({
                        id: account.id,
                        username: account.username,
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="尚未连接 Bangumi" />
      )}

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!save.isPending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "编辑账号" : "添加 Bangumi 账号"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <fieldset disabled={save.isPending} className="min-w-0">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="account-token">Bangumi Token</FieldLabel>
                  <Input
                    id="account-token"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required={!editing}
                  />
                  <FieldDescription>
                    {editing ? "留空保留当前 Token。" : "填写 Bangumi 个人令牌"}
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="plex-users">Plex 用户名</FieldLabel>
                  <Input
                    id="plex-users"
                    value={users}
                    onChange={(e) => setUsers(e.target.value)}
                    required
                  />
                  <FieldDescription>多个用户名用逗号分隔</FieldDescription>
                </Field>

                <Field orientation="horizontal">
                  <FieldLabel htmlFor="account-enabled">启用同步</FieldLabel>
                  <Switch
                    id="account-enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                </Field>

                <Field orientation="horizontal">
                  <FieldLabel htmlFor="account-private">私密收藏</FieldLabel>
                  <Switch
                    id="account-private"
                    checked={isPrivate}
                    onCheckedChange={setPrivate}
                  />
                </Field>

                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "正在验证…" : "保存账号"}
                </Button>
              </FieldGroup>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
