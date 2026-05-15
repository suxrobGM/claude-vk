/**
 * Param / response shapes for every VK API method we wrap. One interface per
 * call so service code reads `vk.sendMessage(params: SendMessageParams)` and
 * tests stub a typed surface — never a raw vk-io payload.
 */

export interface SendMessageParams {
  peer_id: number;
  message: string;
  reply_to?: number;
  random_id: number;
  /** JSON-stringified VK keyboard object (inline or full). */
  keyboard?: string;
}

export interface SendMessageResponse {
  conversation_message_id: number;
  message_id: number;
}

export interface EditMessageParams {
  peer_id: number;
  conversation_message_id: number;
  message: string;
}

export interface DeleteMessageParams {
  peer_id: number;
  conversation_message_ids: number[];
  delete_for_all: 0 | 1;
}

export interface UsersGetParams {
  /** Comma-separated user IDs or screen names. */
  user_ids: string;
  fields?: string;
}

export interface UsersGetResponseEntry {
  id: number;
  first_name?: string;
  last_name?: string;
  screen_name?: string;
  photo_100?: string;
  deactivated?: string;
}

export interface GroupsGetByIdResponseEntry {
  id: number;
  name?: string;
  screen_name?: string;
  photo_100?: string;
}

export interface SendReactionParams {
  peer_id: number;
  cmid: number;
  reaction_id: number;
}

export interface MarkAsReadParams {
  peer_id: number;
  start_message_id?: number;
}

export interface GetHistoryParams {
  peer_id: number;
  count: number;
  offset?: number;
  start_message_id?: number;
  extended?: 0 | 1;
}

export interface SearchMessagesParams {
  q: string;
  peer_id?: number;
  count: number;
  offset?: number;
}

export interface GetPhotoUploadServerParams {
  peer_id: number;
}

export interface SaveMessagesPhotoParams {
  photo: string;
  server: number;
  hash: string;
}

export interface GetDocUploadServerParams {
  peer_id: number;
  type: "doc" | "audio_message";
}

export interface DocsSaveParams {
  file: string;
  title?: string;
}

export interface UploadServerInfo {
  upload_url: string;
}

export interface SavedAttachmentRef {
  /** Canonical `photo<owner>_<id>` or `doc<owner>_<id>`. */
  vk_ref: string;
}

export interface HistoryAttachment {
  type: string;
  vk_ref: string;
  url?: string;
}

export interface HistoryMessage {
  conversation_message_id: number;
  message_id: number;
  from_id: number;
  date: number;
  text: string;
  reply_to_cmid?: number;
  out: 0 | 1;
  attachments: HistoryAttachment[];
}

export interface GetHistoryResponse {
  count: number;
  items: HistoryMessage[];
  profiles: UsersGetResponseEntry[];
}

export interface SearchMessagesResponse {
  count: number;
  items: HistoryMessage[];
}
