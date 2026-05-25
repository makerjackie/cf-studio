import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ProFeatureGate({
  isOpen,
  onClose,
  featureName,
}: {
  isOpen: boolean;
  onClose: () => void;
  featureName?: string;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Feature unavailable</DialogTitle>
        <DialogDescription>
          {featureName ? `${featureName} is not included in this public fork yet.` : "This feature is not included in this public fork yet."}
        </DialogDescription>
        <Button onClick={onClose}>Close</Button>
      </DialogContent>
    </Dialog>
  );
}
