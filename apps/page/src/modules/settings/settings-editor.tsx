import { Button } from "@page/components/ui/button";
import { UnsavedChanges } from "@page/components/unsaved-changes";
import type { PublicSettings, Settings } from "@page/hooks/use-settings-query";
import { api, unwrap } from "@page/lib/api";
import { PlexSettings } from "@page/modules/plex/plex-settings";
import { GeneralSettings } from "@page/modules/settings/general-settings";
import { TitleIndex } from "@page/modules/settings/title-index";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

interface SettingsEditorProps {
  initial: PublicSettings;
  plexOnly: boolean;
}

export const SettingsEditor = ({ initial, plexOnly }: SettingsEditorProps) => {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Settings>(() => structuredClone(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(draft) !== baseline;

  const update = <K extends keyof Settings>(
    section: K,
    patch: Partial<Settings[K]>,
  ) => {
    setDraft((value) => ({
      ...value,
      [section]: { ...value[section], ...patch },
    }));
  };

  const save = useMutation({
    mutationFn: async (submitted: Settings) => {
      const latest = unwrap(await api.api.settings.get());

      const value = plexOnly
        ? { ...latest, plex: submitted.plex }
        : {
            ...latest,
            sync: submitted.sync,
            scheduler: submitted.scheduler,
            bangumi: submitted.bangumi,
          };

      value.plex = {
        ...value.plex,
        libraryIds: value.plex.libraryIds
          .map((id) => id.trim())
          .filter(Boolean),
      };

      value.sync = {
        ...value.sync,
        blockedKeywords: value.sync.blockedKeywords
          .map((word) => word.trim())
          .filter(Boolean),
      };

      return unwrap(await api.api.settings.put(value));
    },
    onSuccess: (result, submitted) => {
      // A response to an earlier save must not erase edits typed while waiting.
      setDraft((current) =>
        JSON.stringify(current) === JSON.stringify(submitted)
          ? result
          : current,
      );

      setBaseline(JSON.stringify(result));
      client.setQueryData(["settings"], result);
      toast.success("配置已保存");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <UnsavedChanges dirty={dirty} />

      <h1 className="text-3xl font-semibold tracking-tight">
        {plexOnly ? "Plex" : "同步设置"}
      </h1>

      {plexOnly ? (
        <PlexSettings
          draft={draft}
          update={update}
          dirty={dirty}
          tokenConfigured={initial.plex.tokenConfigured}
        />
      ) : (
        <>
          <GeneralSettings draft={draft} update={update} />
          <TitleIndex />
        </>
      )}

      <div className="flex justify-start">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(draft)}
        >
          {save.isPending ? "保存中…" : "保存配置"}
        </Button>
      </div>
    </div>
  );
};
