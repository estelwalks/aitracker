import { useI18n } from "../../../lib/i18n/context";
import { useWidgetPrefs } from "../../widget/index.ts";
import { Field, Toggle } from "./fields";

/** Mounted only while the dedicated Menu Bar App settings category is open. */
export function MenuBarAppSettingsSection() {
  const { t } = useI18n();
  const { prefs, set: setWidgetPref } = useWidgetPrefs();

  const changeDynamicBar = (enabled: boolean) => {
    void setWidgetPref("menuBarEnabled", enabled);
  };

  return (
    <Field label={t("settings.menuBarApp.dynamicBar")}>
      <Toggle value={prefs.menuBarEnabled} onChange={changeDynamicBar} />
    </Field>
  );
}
