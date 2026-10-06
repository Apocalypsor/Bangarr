import { ErrorState, LoadingState } from "@page/components/page-state";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@page/components/ui/tabs";
import { useSettingsQuery } from "@page/hooks/use-settings-query";
import { AccountSettings } from "@page/modules/accounts/account-settings";
import { AdminSettings } from "@page/modules/auth/admin-settings";
import { PlexSettings } from "@page/modules/plex/plex-settings";
import { SettingsEditor } from "@page/modules/settings/settings-editor";

export const SettingsPage = () => {
  const config = useSettingsQuery();

  if (config.error && !config.data) return <ErrorState error={config.error} />;
  if (config.isPending) return <LoadingState />;

  return (
    <Tabs defaultValue="plex" className="flex flex-col gap-6">
      <TabsList>
        <TabsTrigger value="plex">Plex</TabsTrigger>
        <TabsTrigger value="accounts">Bangumi 账号</TabsTrigger>
        <TabsTrigger value="sync">同步设置</TabsTrigger>
        <TabsTrigger value="admin">管理员</TabsTrigger>
      </TabsList>
      {config.error && <ErrorState error={config.error} />}
      <TabsContent
        value="plex"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <PlexSettings />
      </TabsContent>
      <TabsContent
        value="accounts"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <AccountSettings />
      </TabsContent>
      <TabsContent
        value="sync"
        forceMount
        className="flex flex-col gap-6 data-[state=inactive]:hidden"
      >
        <SettingsEditor key="sync" initial={config.data} />
      </TabsContent>
      <TabsContent
        value="admin"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <AdminSettings />
      </TabsContent>
    </Tabs>
  );
};
