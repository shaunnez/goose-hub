import { Inbox } from 'lucide-react';

export function InboxEmpty() {
  return (
    <div data-testid="inbox-empty" className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Inbox size={40} className="text-fg-4" />
        </div>
        <p className="text-[15px] font-medium text-fg-2 mb-1">Inbox is empty</p>
        <p className="text-[13px] text-fg-4">Use the Capture button in the top bar to add ideas.</p>
      </div>
    </div>
  );
}
