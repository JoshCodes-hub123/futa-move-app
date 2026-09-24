import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listGroupMessages, sendGroupMessage } from "@/services/group-chat";

const QUICK = ["Where should we meet?", "I'm at the meeting point.", "I'll be there in 5 minutes."];

/** Temporary chat for students in this ride group; closes when the ride ends. */
export function GroupChat({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const key = ["group-chat", groupId];
  const msgs = useQuery({ queryKey: key, queryFn: () => listGroupMessages(groupId), refetchInterval: 5000 });
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: (body: string) => sendGroupMessage(groupId, body),
    onSuccess: () => { setText(""); void qc.invalidateQueries({ queryKey: key }); },
  });
  const list = [...(msgs.data ?? [])].reverse();
  const submit = (body: string) => { if (body.trim() && !send.isPending) send.mutate(body); };

  return (
    <section className="mt-7 rounded-card border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-4 text-brand" />
        <p className="section-label">Group chat</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Only students in this ride can see this. It closes when the ride ends.</p>
      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
        {msgs.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : list.length === 0 ? (
          <p className="text-xs text-muted-foreground">No messages yet. Say hi and agree where to meet.</p>
        ) : list.map((m) => (
          <div key={m.id} className={m.is_me ? "ml-auto max-w-[80%] rounded-lg bg-foreground px-3 py-2 text-sm text-background" : "max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm"}>
            {!m.is_me && <p className="text-[0.6875rem] font-semibold text-muted-foreground">{m.first_name}</p>}
            <p className="break-words">{m.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => submit(q)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">{q}</button>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
        <Input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Message your group" aria-label="Message your group" />
        <Button type="submit" size="icon" aria-label="Send" disabled={send.isPending || !text.trim()}>
          {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
      {send.error && <p className="mt-2 text-xs text-destructive">{send.error.message}</p>}
    </section>
  );
}
