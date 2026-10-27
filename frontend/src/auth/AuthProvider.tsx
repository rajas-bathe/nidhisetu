import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { CurrentUser, LoginRequest } from "@sih26265/contracts";
import { fetchCurrentUser, postLogin, postLogout } from "../services/auth";

interface AuthContextValue {
  user: CurrentUser | null;
  /** True while the initial current-user lookup is in flight. */
  isLoading: boolean;
  login: (payload: LoginRequest) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  /** Session has expired mid-usage: clear cached state and force re-auth. */
  handleSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60_000,
  });

  const login = useCallback(
    async (payload: LoginRequest) => {
      const user = await postLogin(payload);
      queryClient.setQueryData(["auth", "me"], user);
      void queryClient.invalidateQueries();
      return user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await postLogout();
    queryClient.removeQueries({ queryKey: ["auth", "me"] });
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const handleSessionExpired = useCallback(() => {
    queryClient.setQueryData(["auth", "me"], null);
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      isLoading: meQuery.isPending,
      login,
      logout,
      handleSessionExpired,
    }),
    [meQuery.data, meQuery.isPending, login, logout, handleSessionExpired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx == null) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
