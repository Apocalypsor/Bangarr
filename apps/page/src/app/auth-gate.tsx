import { Alert, AlertDescription } from "@page/components/ui/alert";
import { Button } from "@page/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@page/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@page/components/ui/field";
import { Input } from "@page/components/ui/input";
import { Skeleton } from "@page/components/ui/skeleton";
import { useAuth } from "@page/providers/auth-provider";
import { LockKeyhole } from "lucide-react";
import { type ReactNode, useState } from "react";

export const AuthGate = ({ children }: { children: ReactNode }) => {
  const { session, login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (session.isPending)
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 p-12">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-60 w-full" />
      </div>
    );

  if (session.data?.user) return children;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <LockKeyhole className="mb-3 size-8 text-primary" />
          <CardTitle>
            {session.data?.needsSetup ? "欢迎使用 Bangarr" : "登录 Bangarr"}
          </CardTitle>
          <CardDescription>
            {session.data?.needsSetup
              ? "创建管理员账号，开始连接 Plex 与 Bangumi。"
              : "登录以管理观看进度与同步任务。"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              login.mutate(
                { username, password },
                { onSuccess: () => setPassword("") },
              );
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">用户名</FieldLabel>
                <Input
                  id="username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete={
                    session.data?.needsSetup
                      ? "new-password"
                      : "current-password"
                  }
                  minLength={12}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {session.data?.needsSetup ? (
                  <p className="text-sm text-muted-foreground">
                    至少 12 个字符。请妥善保管管理员密码。
                  </p>
                ) : null}
              </Field>

              {login.error || session.error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {(login.error || session.error)?.message}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="submit"
                disabled={login.isPending || Boolean(session.error)}
              >
                {login.isPending
                  ? "正在验证…"
                  : session.data?.needsSetup
                    ? "创建管理员"
                    : "登录"}
              </Button>
              {session.error && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={session.isFetching}
                  onClick={() => void session.refetch()}
                >
                  {session.isFetching ? "正在连接…" : "重试连接"}
                </Button>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
