import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function PurchaseScreen({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("feature.unavailable")}</DialogTitle>
        <DialogDescription>
          {t("feature.publicForkNoPro")}
        </DialogDescription>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogContent>
    </Dialog>
  );
}
