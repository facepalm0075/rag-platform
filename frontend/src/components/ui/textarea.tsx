import * as React from "react";
import { cn } from "@/lib/utils";

interface TextareaProps extends React.ComponentProps<"textarea"> {
  autoGrow?: boolean;
  maxHeight?: number; // optional max height in pixels, after which scroll appears
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoGrow = true, maxHeight, value, onChange, ...props }, ref) => {
    const internalRef = React.useRef<HTMLTextAreaElement>(null);

    // Combine forwarded ref with internal ref
    const setRefs = React.useCallback(
      (element: HTMLTextAreaElement | null) => {
        internalRef.current = element;
        if (typeof ref === "function") {
          ref(element);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = element;
        }
      },
      [ref],
    );

    // Auto-grow effect
    React.useEffect(() => {
      if (!autoGrow) return;
      const el = internalRef.current;
      if (!el) return;

      // Reset height to auto to shrink when text is deleted
      el.style.height = "auto";

      // Set new height based on scrollHeight, cap at maxHeight if provided
      let newHeight = el.scrollHeight;
      if (maxHeight && newHeight > maxHeight) {
        newHeight = maxHeight;
        el.style.overflowY = "auto";
      } else {
        el.style.overflowY = "hidden";
      }
      el.style.height = `${newHeight}px`;
    }, [value, autoGrow, maxHeight]); // value is the current content

    return (
      <textarea
        className={cn(
          "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          // Override min-height only when autoGrow is true so it starts small
          autoGrow ? "min-h-[52px] resize-none" : "min-h-[60px]",
          className,
        )}
        ref={setRefs}
        value={value}
        onChange={onChange}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };