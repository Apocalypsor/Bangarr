import { Alert, AlertDescription } from "@page/components/ui/alert";
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
import { useAuth } from "@page/providers/auth-provider";
import { useState } from "react";

export const AdminSettings = () => {
  const { session, updateAccount } = useAuth();
  const [username, setUsername] = useState(session.data?.user?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mismatch = confirmation.length > 0 && confirmation !== newPassword;

  return (
    <Card>
      <CardHeader>
        <CardTitle>管理员账号</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (newPassword !== confirmation) return;

            updateAccount.mutate(
              { username, currentPassword, newPassword },
              {
                onSuccess: () => {
                  setUsername(username.trim());
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmation("");
                },
              },
            );
          }}
        >
          <fieldset disabled={updateAccount.isPending} className="min-w-0">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="admin-username">用户名</FieldLabel>
                <Input
                  id="admin-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  maxLength={100}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="admin-current-password">
                  当前密码
                </FieldLabel>
                <Input
                  id="admin-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  maxLength={200}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="admin-new-password">新密码</FieldLabel>
                <Input
                  id="admin-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={12}
                  maxLength={200}
                  required
                />
                <FieldDescription>至少 12 个字符</FieldDescription>
              </Field>
              <Field data-invalid={mismatch}>
                <FieldLabel htmlFor="admin-confirm-password">
                  确认新密码
                </FieldLabel>
                <Input
                  id="admin-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  minLength={12}
                  maxLength={200}
                  aria-invalid={mismatch}
                  required
                />
                {mismatch && (
                  <FieldDescription>两次输入的密码不一致。</FieldDescription>
                )}
              </Field>
              {updateAccount.error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {updateAccount.error.message}
                  </AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                className="self-start"
                disabled={updateAccount.isPending || mismatch}
              >
                {updateAccount.isPending ? "保存中…" : "保存"}
              </Button>
            </FieldGroup>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
};
