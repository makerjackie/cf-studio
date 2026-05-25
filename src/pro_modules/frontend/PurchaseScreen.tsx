import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function PurchaseScreen({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Feature unavailable</DialogTitle>
        <DialogDescription>
          This public fork ships without the original private Pro module. Add your own implementation here when the workflow is worth keeping.
        </DialogDescription>
        <Button onClick={onClose}>Close</Button>
      </DialogContent>
    </Dialog>
  );
}
