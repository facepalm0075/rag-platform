
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useParams } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Pencil,
  Layers,
  AlertTriangle,
  Info,
  XCircle,
} from "lucide-react";
import * as api from "@/lib/api";
import { chat } from "@/config";
import { Button } from "@/components/ui/button";
import { Skeleton, Spinner } from "@/components/ui/skeleton";
import { SessionEntriesModal } from "@/components/session-entries-modal";
import { usePageTitle } from "@/lib/use-page-title";
import { useIsMobile } from "@/lib/use-is-mobile";
import { scrollToBottom } from '@/lib/utils';
import ChatInput from '@/components/chat/ChatInput';
import React from 'react';
import { MarkdownWrapper } from '@/components/chat/MarkdownWrapper';

export function Chat() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<api.Session | null>(null);
  const [messages, setMessages] = useState<api.Message[] | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [streaming, setStreaming] = useState<api.StreamPart | null>(null);
  const [busy, setBusy] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const inputFunctionsRef = useRef<{resetInput: ()=>void, inputFocus: ()=>void}>(
    {resetInput: ()=>{}, inputFocus: ()=>{}}
  );

  const isMobile = useIsMobile();

  const streamingRef = useRef<api.StreamPart | null>(null);
  const firstLoadRef = useRef(true);
  const abortControllerRef = useRef(new AbortController());

  usePageTitle(session ? `${session.name} — RAG Studio` : "Chat — RAG Studio");

  useEffect(() => {
    firstLoadRef.current = true;
    let cancelled = false;
    setSession(null);
    setMessages(null);
    setOffset(null);
    setHasMore(false);
    stickToBottom.current = true;
    if (!sessionId) return;
    api.getSession(sessionId).then((s) => {
      if (cancelled) return;
      setSession(s);
      if (!s) return;
      return api.listMessages(s.conversationId).then((page) => {
        if (cancelled) return;
        setMessages(page.messages);
        setOffset(page.nextOffset);
        setHasMore(page.hasMore);
      });
    });
    setStreaming(null);
    inputFunctionsRef.current.resetInput();
    inputFunctionsRef.current.inputFocus();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if(!firstLoadRef.current || !messages || !scrollRef || !scrollRef.current) return;
    
    const target = scrollRef.current.querySelector("div.mt-0\\.5.flex.h-7.w-7.shrink-0.items-center.justify-center.rounded-full.border.border-border.bg-muted.text-xs.font-medium");
    if(target){
      scrollToBottom(scrollRef.current).then(()=>{
        firstLoadRef.current = false;
      });
    }
  }, [messages]);

  useEffect(() => {
    if (!stickToBottom.current) return;

    const el = scrollRef.current;
    if (!el) return;

    if (streaming && streaming.content) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streaming]);

  useEffect(() => {
    if (!stickToBottom.current) return;

    const el = scrollRef.current;
    if (!el) return;

    requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [messages]);

  const loadingMoreRef = useRef(false);
  /** Load the previous page and keep the reading position stable. */
  const loadOlder = useCallback(async () => {
    const el = scrollRef.current;

    if (
      !el ||
      loadingMoreRef.current ||
      !hasMore ||
      offset === null ||
      !session
    ) {
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);
    stickToBottom.current = false;

    // Find the first currently rendered message as our anchor.
    const anchor = el.querySelector<HTMLElement>("[data-message-id]");

    if (!anchor) {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      return;
    }

    const anchorId = anchor.dataset.messageId;
    const previousTop = anchor.getBoundingClientRect().top;

    try {
      const page = await api.listMessages(
        session.conversationId,
        { offset }
      );

      setMessages((m) => [...page.messages, ...(m ?? [])]);
      setOffset(page.nextOffset);
      setHasMore(page.hasMore);

      requestAnimationFrame(() => {
        const next = scrollRef.current;

        if (!next || !anchorId) return;

        const newAnchor = next.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(anchorId)}"]`
        );

        if (newAnchor) {
          const newTop = newAnchor.getBoundingClientRect().top;
          next.scrollTop += newTop - previousTop;
        }

        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
    } catch (error) {
      loadingMoreRef.current = false;
      setLoadingMore(false);
      throw error;
    }
  }, [hasMore, offset, session]);

  const onScroll = () => {

    const el = scrollRef.current;
    if (!el || loadingMoreRef.current || firstLoadRef.current) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  
    // Keep your existing logic for auto-scrolling when new messages arrive
    stickToBottom.current = distanceFromBottom < 120;

    // Show button if distance from bottom is greater than 200px
    const shouldShow = distanceFromBottom > 200;

    setShowScrollButton((previous) => {
      return previous === shouldShow ? previous : shouldShow;
    });
    
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < chat.scrollLoadThresholdPx) {
      void loadOlder();
    }
  };

  const changeOffset = (offsetNumber = 1) => {
    if(offsetNumber < 1) return;
    setOffset((os)=>os ? os + offsetNumber : null);
  }

  const addMessage = (newMessage: api.Message) => {
    setMessages((m) => [...(m ?? []), newMessage]);
  };

  const stopStreaming = () => {
    abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
  };

  const generateRandomNumber = ()=>{
    return Math.floor(Math.random() * 100);
  }

  const flushStreamedBuffer = ()=>{
    const data = streamingRef.current;
    if (data && data.content) {
      addMessage({
        id: `temp-${Date.now() + generateRandomNumber()}`,
        sessionId: session!.conversationId,
        role: data.role,
        content: data.content,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const onSubmit = async (text: string) => {
    if (busy) {
      stopStreaming();
      return;
    }

    if (!text || !session) return;
    const conversationId = session.conversationId;
    setBusy(true);
    inputFunctionsRef.current.resetInput();
    stickToBottom.current = true;

    // Optimistic user message
    const optimistic: api.Message = {
      id: `temp-${Date.now()}`,
      sessionId: conversationId,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    addMessage(optimistic);
    setStreaming({ role: "assistant", content: "" });

    try {
      for await (const partial of api.sendMessage(
        conversationId,
        text,
        abortControllerRef.current.signal,
      )) {
        if(streamingRef.current && streamingRef.current.content === "") changeOffset(2);
        setStreaming(partial);
        streamingRef.current = partial;
      }

      flushStreamedBuffer();
    } catch(err) {
      if (err instanceof Error) {
        let isClient = false;
        let isAborted = false;
        let store = true;
        if(err.cause && typeof err.cause === "object" && (err.cause as Record<string, string>).type === "client"){
          isClient = true;

          const reason = (err.cause as Record<string, string>).reason;
          if(reason && reason === "aborted"){
            isAborted = true;
          }

          const dontStore = (err.cause as Record<string, string>).dontStore;
          if(dontStore) store = false;
        }

        flushStreamedBuffer();
        addMessage({
          id: `temp-${Date.now() + generateRandomNumber()}`,
          sessionId: conversationId,
          role: "system",
          content: err.message,
          level: isClient ? (isAborted ? "info" : "warning") : "error",
          createdAt: new Date().toISOString(),
        });

        changeOffset(isClient ? (store ? 1 : 0) : streaming ? 1 : 2);
      }
      
    } finally {
      setStreaming(null);
      streamingRef.current = null;
      setBusy(false);
      inputFunctionsRef.current.inputFocus();
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border py-4 pl-8 pr-8">
        {session ? (
          <div className="flex min-w-0 items-center gap-3">
            {!isMobile && 
              <>
                {session.sourceType === "manual" ? (
                  <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                )} 
              </>
            }
            <div className={`min-w-0 ${isMobile ? 'ml-10' : ''}`}>
              <h1 className="truncate text-sm font-medium">{session.name}</h1>
              <p className="truncate text-xs text-muted-foreground">{session.sourceMeta}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        )}
        {session ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setEntriesOpen(true)}
          >
            <Layers className="h-4 w-4" />
            View {session.chunkCount != null ? `${session.chunkCount} chunks` : "chunks"}
          </Button>
        ) : (
          <Skeleton className="h-8 w-32" />
        )}
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">
          {messages === null ? (
            <div className="space-y-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-11/12" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="mb-6 flex justify-center">
                  {loadingMore ? (
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner className="h-3.5 w-3.5" /> Loading earlier messages…
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void loadOlder()}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
                    >
                      Load earlier messages
                    </button>
                  )}
                </div>
              )}

              {messages.length === 0 && !streaming && (
                <div className="py-20 text-center">
                  <h2 className="text-lg font-medium">Ask your first question</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Responses are grounded in the source you provided.
                  </p>
                </div>
              )}

              <div className="space-y-6">
                {messages.map((m) => (
                  <div key={m.id} data-message-id={m.id}>
                    <MessageBubble  role={m.role} level={m.level} content={m.content} />
                  </div>
                ))}
                {streaming !== null && (
                  <MessageBubble
                    role={streaming.role}
                    level={streaming.level}
                    content={streaming.content || "Generating..."}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background px-8 py-4">
        <ChatInput
          busy={busy}
          onGoToBottom={() => {
            stickToBottom.current = true;
            setShowScrollButton(false);
            scrollRef.current?.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }} 
          onSubmit={onSubmit}
          placeholder={chat.inputPlaceholder}
          showScrollButton={showScrollButton}
          getFunctions={(funcs)=>{
            inputFunctionsRef.current = funcs;
          }}
        />
        
      </div>

      <SessionEntriesModal
        sessionId={sessionId ?? null}
        open={entriesOpen}
        onClose={() => setEntriesOpen(false)}
      />
    </div>
  );
}

const LEVEL_STYLES: Record<api.SystemLevel, { wrap: string; label: string; Icon: typeof Info }> = {
  info: {
    wrap: "border-border bg-muted/40 text-foreground",
    label: "System",
    Icon: Info,
  },
  warning: {
    wrap: "border-amber-500/40 bg-amber-500/10 text-foreground",
    label: "System warning",
    Icon: AlertTriangle,
  },
  error: {
    wrap: "border-destructive/40 bg-destructive/10 text-foreground",
    label: "System error",
    Icon: XCircle,
  },
};

const MessageBubble = React.memo(
  function MessageBubble({
  role,
  level,
  content,
}: {
  role: api.MessageRole;
  level?: api.SystemLevel;
  content: string;
}) {
  const markdownComponents = {
    code({ inline, className, children, ...props }: any) {
      if (inline) {
        return (
          <code
            className="rounded bg-muted px-1 py-0.5 text-sm"
            {...props}
          >
            {children}
          </code>
        );
      }

      return (
        <code
          className="block whitespace-pre-wrap break-words text-sm"
          {...props}
        >
          {children}
        </code>
      );
    },

    pre({ children }: any) {
      return (
        <pre className="my-2 max-w-full overflow-x-auto rounded bg-muted p-3">
          {children}
        </pre>
      );
    },

    a({ href, children }: any) {
      return (
        <a
          href={href}
          className="text-primary underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },

    ul({ children }: any) {
      return <ul className="my-1 list-disc pl-5">{children}</ul>;
    },

    ol({ children }: any) {
      return <ol className="my-1 list-decimal pl-5">{children}</ol>;
    },

    blockquote({ children }: any) {
      return (
        <blockquote className="my-2 border-l-4 border-muted-foreground pl-4 italic">
          {children}
        </blockquote>
      );
    },
  };

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <MarkdownWrapper className="max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {content}
          </ReactMarkdown>
        </MarkdownWrapper>
      </div>
    );
  }

  if (role === 'system') {
    const s = LEVEL_STYLES[level ?? 'error'];
    return (
      <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 ${s.wrap}`}>
        <s.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <MarkdownWrapper className="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">
          {content}
        </MarkdownWrapper>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium">
        AI
      </div>
      <MarkdownWrapper className="max-w-[85%] rounded-2xl border border-border bg-card px-4 py-2.5">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </MarkdownWrapper>
    </div>
  );
})
