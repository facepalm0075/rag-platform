import { FormEvent, useEffect, useRef, useState } from "react";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { ArrowUp, LucideChevronDown, Square } from "lucide-react";

type props = {
  onSubmit: (text: string) => void; 
  onGoToBottom: () => void; 
  busy: boolean;
  showScrollButton: boolean;
  placeholder: string;
  getFunctions: (funcs: {resetInput: ()=>void, inputFocus: ()=>void}) => void
}

function ChatInput({
  busy,
  onSubmit,
  showScrollButton,
  placeholder,
  onGoToBottom,
  getFunctions
}: props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  const resetInput = ()=>{
    setInput("");
  }

  const inputFocus = ()=>{
    inputRef?.current?.focus();
  }

  useEffect(()=>{
    const funcs = {
        resetInput,
        inputFocus
    }

    getFunctions(funcs);
  }, [])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    onSubmit(text);
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl relative">
        {showScrollButton && (
        <button
            onClick={onGoToBottom}
            className="absolute right-2 cursor-pointer -top-16 z-50 transform rounded-full border-2 border-white/30 bg-stone-600 px-1 py-1 text-sm font-medium text-primary-foreground shadow-xl hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-ring"          >
            <LucideChevronDown/>
        </button>
        )}
        <div className="relative rounded-xl border border-border bg-card focus-within:ring-2 focus-within:ring-ring/40">
        <Textarea
            maxHeight={120}
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                !busy && handleSubmit(e as unknown as FormEvent);
            }
            }}
            placeholder={placeholder}
            rows={1}
            className="min-h-[52px] resize-none border-0 bg-transparent pr-14 shadow-none focus-visible:ring-0"
        />
        <Button
            type="submit"
            size="icon"
            className="absolute bottom-2 right-4 h-8 w-8"
            aria-label="Send"
        >
            {busy ? (
            <Square fill="white" style={{ width: "12px", height: "12px" }} />
            ) : (
            <ArrowUp className="h-4 w-4" />
            )}
        </Button>
        </div>
    </form>
  );
}

export default ChatInput;