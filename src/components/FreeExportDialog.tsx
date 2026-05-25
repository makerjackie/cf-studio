import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { exportFileName, rowsToFormat, type TabularExportFormat } from "@/lib/tabularExport";

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dataToExport: Record<string, unknown>[];
  allColumns: string[];
}

export function FreeExportDialog({ isOpen, onClose, dataToExport, allColumns }: ExportDialogProps) {
  const { t } = useI18n();
  const [format, setFormat] = useState<TabularExportFormat>("csv");
  const [status, setStatus] = useState<"idle" | "saving" | "copying">("idle");
  const [error, setError] = useState<string | null>(null);
  const exportText = useMemo(
    () => rowsToFormat(dataToExport, allColumns, format),
    [allColumns, dataToExport, format]
  );

  const handleSave = async () => {
    setStatus("saving");
    setError(null);
    try {
      const destinationPath = await save({
        defaultPath: exportFileName("d1-rows", format),
        filters: [
          format === "csv"
            ? { name: "CSV", extensions: ["csv"] }
            : { name: "JSON", extensions: ["json"] },
        ],
      });
      if (!destinationPath) {
        setStatus("idle");
        return;
      }
      await writeTextFile(destinationPath, exportText);
      setStatus("idle");
      onClose();
    } catch (saveError) {
      setError(String(saveError));
      setStatus("idle");
    }
  };

  const handleCopy = async () => {
    setStatus("copying");
    setError(null);
    try {
      await writeText(exportText, { label: "CF Studio" });
      setStatus("idle");
      onClose();
    } catch (copyError) {
      setError(String(copyError));
      setStatus("idle");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("d1.export.title")}</DialogTitle>
          <DialogDescription>
            {t("d1.export.body", { count: dataToExport.length, columns: allColumns.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(["csv", "json"] as const).map((item) => (
              <Button
                key={item}
                type="button"
                variant={format === item ? "default" : "outline"}
                onClick={() => setFormat(item)}
              >
                {item.toUpperCase()}
              </Button>
            ))}
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              {t("d1.export.preview", { rows: dataToExport.length, columns: allColumns.length })}
            </p>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={status !== "idle"}>
            {t("common.cancel")}
          </Button>
          <Button variant="outline" onClick={handleCopy} disabled={status !== "idle" || dataToExport.length === 0}>
            {status === "copying" ? t("common.copying") : t("common.copy")}
          </Button>
          <Button onClick={handleSave} disabled={status !== "idle" || dataToExport.length === 0}>
            {status === "saving" ? t("common.saving") : t("d1.export.saveFile")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
