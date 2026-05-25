import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dataToExport: Record<string, unknown>[];
  allColumns: string[];
}

export function FreeExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("d1.export.proTitle")}</DialogTitle>
          <DialogDescription>
            {t("d1.export.proBody")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>{t("d1.export.understood")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
