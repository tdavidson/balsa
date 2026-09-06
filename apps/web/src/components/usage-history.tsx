"use client";

import { useMemo, useState } from "react";
import { MessageSquareText, Search } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";

type UsageConversation = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function UsageHistory({ conversations }: { conversations: UsageConversation[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return conversations;
    return conversations.filter((conversation) => `${conversation.question}\n${conversation.answer}`.toLowerCase().includes(search));
  }, [conversations, query]);

  return (
    <div className="grid gap-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="display text-[24px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 24' }}>Conversation history</h2>
          <p className="mt-1 text-[13px] text-ink-2">{query ? `${filtered.length} of ${conversations.length} turns` : `${conversations.length} turns`}</p>
        </div>
        <label className="relative block w-full sm:w-[320px]">
          <span className="sr-only">Search conversation history</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-pencil" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search questions and responses"
            className="h-9 rounded-lg border-rule bg-transparent pl-9 shadow-none"
          />
        </label>
      </div>

      {filtered.length ? (
        <Accordion type="multiple" className="border-t border-rule">
          {filtered.map((conversation) => (
            <AccordionItem value={conversation.id} key={conversation.id}>
              <AccordionTrigger className="gap-5 py-3.5 hover:no-underline">
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="line-clamp-2 text-[15px] leading-5 text-ink">{conversation.question}</span>
                  <span className="text-[12px] font-normal text-pencil">{dateFormatter.format(new Date(conversation.createdAt))}</span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="grid gap-3 pb-5">
                <div className="flex justify-end">
                  <p className="max-w-[82%] rounded-[18px] bg-rule px-4 py-2.5 text-[15px] leading-[1.45] text-ink sm:max-w-[70%]">{conversation.question}</p>
                </div>
                {conversation.answer ? (
                  <div className="flex justify-start">
                    <p className="prose-serif max-w-[62ch] text-[16px] leading-[1.5] text-ink" style={{ fontVariationSettings: '"opsz" 16' }}>{conversation.answer}</p>
                  </div>
                ) : <p className="text-[13px] text-ink-2">No response was recorded for this turn.</p>}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <Empty className="border border-rule py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MessageSquareText aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>{query ? "No matching conversations" : "No conversations yet"}</EmptyTitle>
            <EmptyDescription>{query ? "Try a different word or phrase." : "Ask a question in chat and it will appear here."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
