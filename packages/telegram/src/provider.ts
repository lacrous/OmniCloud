import { Api, TelegramClient } from "telegram";
import bigInt from "big-integer";
import { CustomFile } from "telegram/client/uploads.js";
import {
  StorageProviderError,
  mapProviderError,
  type StorageProvider,
  type StorageUploadInput,
  type StoredObject,
  type StoredRef,
} from "@omnicloud/core";
import { mapTelegramError } from "./errors";

export interface TelegramStorageOptions {
  /** Raw channel id of the user's private storage channel. */
  chatId: string;
  /** Channel access hash required to build the input peer. */
  accessHash: string;
}

/**
 * StorageProvider implementation backed by the user's private Telegram
 * channel. Files are sent as force-downloaded documents (no compression),
 * so every upload is a document message in the channel.
 */
export class TelegramStorageProvider implements StorageProvider {
  readonly name = "telegram";
  private readonly peer: Api.InputPeerChannel;

  constructor(
    private readonly client: TelegramClient,
    options: TelegramStorageOptions,
  ) {
    this.peer = new Api.InputPeerChannel({
      channelId: bigInt(options.chatId),
      accessHash: bigInt(options.accessHash),
    });
  }

  async put(input: StorageUploadInput): Promise<StoredObject> {
    try {
      const file = new CustomFile(input.name, input.data.byteLength, "", input.data);
      const message = await this.client.sendFile(this.peer, {
        file,
        forceDocument: true,
        workers: 1,
      });
      if (!(message instanceof Api.Message)) {
        throw new StorageProviderError("Telegram returned an unexpected upload response");
      }
      return {
        messageId: message.id.toString(),
        name: input.name,
        size: input.data.byteLength,
        mimeType: input.mimeType,
      };
    } catch (error) {
      throw mapTelegramError(error, "Telegram upload failed");
    }
  }

  async get(ref: StoredRef): Promise<Buffer> {
    let data: Buffer | string | undefined;
    try {
      const message = await this.getMessage(ref.messageId);
      if (!message?.media) {
        throw new StorageProviderError("The stored file is missing from Telegram");
      }
      data = await this.client.downloadMedia(message, {});
    } catch (error) {
      if (error instanceof StorageProviderError) throw error;
      throw mapTelegramError(error, "Telegram download failed");
    }
    if (!data || typeof data === "string") {
      throw new StorageProviderError("Telegram did not return file content");
    }
    return Buffer.from(data);
  }

  async delete(ref: StoredRef): Promise<void> {
    try {
      await this.client.deleteMessages(this.peer, [Number(ref.messageId)], { revoke: true });
    } catch (error) {
      throw mapTelegramError(error, "Telegram delete failed");
    }
  }

  async exists(ref: StoredRef): Promise<boolean> {
    try {
      return (await this.stat(ref)) !== null;
    } catch (error) {
      throw mapTelegramError(error, "Telegram lookup failed");
    }
  }

  async stat(ref: StoredRef): Promise<StoredObject | null> {
    let message: Api.Message | undefined;
    try {
      message = await this.getMessage(ref.messageId);
    } catch (error) {
      throw mapTelegramError(error, "Telegram lookup failed");
    }
    if (!message?.media) return null;

    const document = message.document;
    if (!(document instanceof Api.Document)) return null;

    let fileName: string | undefined;
    for (const attr of document.attributes) {
      if (attr instanceof Api.DocumentAttributeFilename) {
        fileName = attr.fileName;
        break;
      }
    }
    return {
      messageId: ref.messageId,
      name: fileName ?? "file",
      size: Number(document.size.toString()),
      mimeType: document.mimeType,
    };
  }

  private async getMessage(id: string): Promise<Api.Message | undefined> {
    const messages = await this.client.getMessages(this.peer, { ids: [Number(id)] });
    const first = messages[0];
    return first instanceof Api.Message ? first : undefined;
  }
}

// Re-exported so hosts can wrap provider errors consistently.
export { mapProviderError };
