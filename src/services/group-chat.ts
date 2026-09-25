import { friendlyMessage } from "@/lib/friendly-error";
import { supabase } from "@/integrations/supabase/client";

export interface GroupMessage { id: string; first_name: string; is_me: boolean; body: string; created_at: string }

export async function listGroupMessages(groupId: string): Promise<GroupMessage[]> {
  const { data, error } = await supabase.rpc("list_group_messages", { p_group_id: groupId });
  if (error) throw new Error(friendlyMessage(error.message));
  return (data ?? []) as GroupMessage[];
}
export async function sendGroupMessage(groupId: string, body: string) {
  const { error } = await supabase.rpc("send_group_message", { p_group_id: groupId, p_body: body });
  if (error) throw new Error(friendlyMessage(error.message));
}
