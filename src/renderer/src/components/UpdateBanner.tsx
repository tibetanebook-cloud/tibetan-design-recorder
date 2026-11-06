/** Asks whether to update, then shows the download and the restart. "Later" hides it for this session. */
import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/updates";
import { useEditor } from "../store";

/** The update closes the app, so the project is saved first. Cancelling the save stops the restart. */
async function saveThenRestart(): Promise<void> {
  const editor = useEditor.getState();
  if (editor.saveState !== "saved") {
    await editor.save();
    if (useEditor.getState().saveState !== "saved") return;
  }
  await window.tdr.update.install();
}

export function UpdateBanner() {
  const t = useEditor((s) => s.t);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    void window.tdr.update.current().then((found) => found && setUpdate(found));
    return window.tdr.update.onState(setUpdate);
  }, []);

  if (!update || hidden === `${update.phase}:${update.version}`) return null;
  const later = <button onClick={() => setHidden(`${update.phase}:${update.version}`)}>{t("help.updateLater")}</button>;
  const version = <b lang="en" data-l10n-skip>{update.version}</b>;

  return (
    <div className="update-banner" role="status" data-update-banner={update.phase}>
      {update.phase === "available" && (
        <>
          <span>{t("help.updateAsk")} {version}</span>
          <button className="primary" onClick={() => void window.tdr.update.download()}>{t("help.updateYes")}</button>
          {later}
        </>
      )}
      {update.phase === "downloading" && (
        <>
          <span>{t("help.updateDownloading")} <span lang="en" data-l10n-skip>{update.percent ?? 0}%</span></span>
          <progress max={100} value={update.percent ?? 0} />
        </>
      )}
      {update.phase === "ready" && (
        <>
          <span>{t("help.updateReady")}</span>
          <button className="primary" onClick={() => void saveThenRestart()}>{t("help.updateRestart")}</button>
          {later}
        </>
      )}
      {update.phase === "failed" && (
        <>
          <span>{t("help.updateDownloadFailed")}</span>
          <button className="primary" onClick={() => void window.tdr.update.openPage()}>{t("help.updateOpenPage")}</button>
          {later}
        </>
      )}
    </div>
  );
}
