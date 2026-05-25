import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function ProFeatureGate({
  isOpen,
  onClose,
  featureName,
}: {
  isOpen: boolean;
  onClose: () => void;
  featureName?: string;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("feature.unavailable")}</DialogTitle>
        <DialogDescription>
          {featureName ? t("feature.unavailableNamed", { feature: featureName }) : t("feature.unavailableBody")}
        </DialogDescription>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogContent>
    </Dialog>
  );
}
