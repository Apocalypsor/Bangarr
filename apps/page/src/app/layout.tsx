import { Button } from "@page/components/ui/button";
import { Separator } from "@page/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@page/components/ui/sheet";
import { useAuth } from "@page/providers/auth-provider";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowRightLeft,
  CheckCheck,
  ChevronRight,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";

const navigation = [
  { to: "/", title: "同步记录", icon: CheckCheck },
  { to: "/matching", title: "匹配与映射", icon: ArrowRightLeft },
  { to: "/settings", title: "设置", icon: Settings },
] as const;

export const Layout = () => {
  const { logout } = useAuth();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = (
    <nav aria-label="主导航" className="flex flex-col gap-1 p-3">
      {navigation.map(({ to, title, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: to === "/" }}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            path === to && "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" />
          {title}
        </Link>
      ))}
    </nav>
  );

  const brand = (
    <Link
      to="/"
      className="flex items-center gap-3 px-6 py-6 font-semibold tracking-tight"
    >
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        B
      </span>
      Bangarr
    </Link>
  );

  const accountControls = (
    <div className="mt-auto flex flex-col gap-3 p-4">
      <Button
        variant="outline"
        className="justify-start"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        {resolvedTheme === "dark" ? (
          <Moon data-icon="inline-start" />
        ) : (
          <Sun data-icon="inline-start" />
        )}
        {resolvedTheme === "dark" ? "深色模式" : "浅色模式"}
      </Button>
      <Separator />
      <Button
        variant="ghost"
        className="justify-start"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        <LogOut data-icon="inline-start" />
        退出登录
      </Button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background">
      <aside
        data-testid="persistent-sidebar"
        className="fixed inset-y-0 left-0 hidden w-60 flex-col overflow-y-auto border-r bg-sidebar md:flex"
      >
        {brand}
        {links}
        {accountControls}
      </aside>
      <div className="md:pl-60">
        <header className="flex h-16 items-center gap-3 border-b px-5 md:px-8">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="打开导航"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="overflow-y-auto">
              <SheetTitle className="sr-only">导航</SheetTitle>
              {brand}
              {links}
              {accountControls}
            </SheetContent>
          </Sheet>
          <span className="text-sm text-muted-foreground">工作台</span>
          <ChevronRight className="size-3 text-muted-foreground" />
          <span className="text-sm">
            {navigation.find((item) => item.to === path)?.title ?? "详情"}
          </span>
        </header>

        <main className="mx-auto max-w-7xl p-5 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
