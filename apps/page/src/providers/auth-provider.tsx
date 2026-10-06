import { useSessionQuery } from "@page/hooks/use-session-query";
import { api, unwrap } from "@page/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, type PropsWithChildren, useContext } from "react";
import { toast } from "sonner";

type Credentials = Parameters<typeof api.api.auth.login.post>[0];
type AuthContextValue = ReturnType<typeof useAuthState>;

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const auth = useAuthState();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const auth = useContext(AuthContext);

  if (!auth) throw new Error("useAuth must be used within AuthProvider");

  return auth;
};

const useAuthState = () => {
  const client = useQueryClient();

  const session = useSessionQuery();

  const login = useMutation({
    mutationFn: async (credentials: Credentials) =>
      unwrap(await api.api.auth.login.post(credentials)),
    onSuccess: () => client.invalidateQueries({ queryKey: ["session"] }),
  });

  const updateAccount = useMutation({
    mutationFn: async (input: Parameters<typeof api.api.auth.account.put>[0]) =>
      unwrap(await api.api.auth.account.put(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["session"] });
      toast.success("账号已更新");
    },
  });

  const logout = useMutation({
    mutationFn: async () => unwrap(await api.api.auth.logout.post()),
    onSuccess: () => {
      client.clear();
      window.location.assign("/");
    },
    onError: (error) => toast.error(error.message),
  });

  return { session, login, logout, updateAccount };
};
