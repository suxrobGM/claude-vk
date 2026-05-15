import type {
  DeleteMessageParams,
  DocsSaveParams,
  EditMessageParams,
  GetDocUploadServerParams,
  GetHistoryParams,
  GetHistoryResponse,
  GetPhotoUploadServerParams,
  GroupsGetByIdResponseEntry,
  MarkAsReadParams,
  SavedAttachmentRef,
  SaveMessagesPhotoParams,
  SearchMessagesParams,
  SearchMessagesResponse,
  SendMessageParams,
  SendMessageResponse,
  SendReactionParams,
  UploadServerInfo,
  UsersGetParams,
  UsersGetResponseEntry,
} from "./api.types";

/**
 * Narrow VK contract every messaging/history/users tool depends on. `VkClient`
 * is the production implementation; tests pass a plain-object stub. Every
 * method routes through `RateLimiter.withRetry` in the real impl so the 20
 * req/s quota and error-6/error-9 policy apply uniformly.
 */
export interface VkApi {
  sendMessage(p: SendMessageParams): Promise<SendMessageResponse>;
  editMessage(p: EditMessageParams): Promise<number>;
  deleteMessage(p: DeleteMessageParams): Promise<Record<string, number>>;
  usersGet(p: UsersGetParams): Promise<UsersGetResponseEntry[]>;
  sendReaction(p: SendReactionParams): Promise<void>;
  markAsRead(p: MarkAsReadParams): Promise<void>;
  getHistory(p: GetHistoryParams): Promise<GetHistoryResponse>;
  searchMessages(p: SearchMessagesParams): Promise<SearchMessagesResponse>;
  getPhotoUploadServer(p: GetPhotoUploadServerParams): Promise<UploadServerInfo>;
  saveMessagesPhoto(p: SaveMessagesPhotoParams): Promise<SavedAttachmentRef>;
  getDocUploadServer(p: GetDocUploadServerParams): Promise<UploadServerInfo>;
  saveDoc(p: DocsSaveParams): Promise<SavedAttachmentRef>;
  /** Returns the community the access token belongs to (no params needed). */
  groupsGetSelf(): Promise<GroupsGetByIdResponseEntry>;
}
