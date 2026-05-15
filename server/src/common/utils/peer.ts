// VK convention: peer_id >= 2_000_000_000 designates a multi-user chat,
// anything below is a single user (DM).
export const GROUP_CHAT_PEER_OFFSET = 2_000_000_000;

export function isGroupChat(peerId: number): boolean {
  return peerId >= GROUP_CHAT_PEER_OFFSET;
}
