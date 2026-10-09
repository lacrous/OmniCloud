import { Readable } from "node:stream";
import { Api, TelegramClient } from "telegram";
import bigInt from "big-integer";
import { CustomFile } from "telegram/client/uploads.js";
import {
  OperationCancelledError,
  TelegramAuthRequiredError,
  TelegramConnectionError,
  TelegramFileNotFoundError,
  UploadFailedError,
  type StorageHealth,
  type StorageProvider,
  type StorageUploadInput,
  type StoredObject,
  type StoredRef,
  type TransferControl,
} from "@omnicloud/core";
import { mapTelegramError } from "./errors";

export interface TelegramStorageOptions {
  /** Raw channel id of the user's private storage channel. */
  chatId: string;
  /** Channel access hash required to build the input peer. */
  accessHash: string;
  /** Human-readable channel title, surfaced in health reporting. */
  title?: string;
}

/** Telegram's own limits for a single uploaded document. */
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/** Largest single `upload.getFile` request Telegram accepts. */
const DOWNLOAD_CHUNK_BYTES = 512 * 1024;

/**
 * StorageProvider implementation backed by the user's private Telegram
 * channel. Files are sent as force-downloaded documents (no compression), so
 * every upload is a document message in the channel.
 *
 * v0.2 adds progress reporting, cancellation, streamed downloads and a
 * health check, all translated into the provider-agnostic core vocabulary.
 */
export class TelegramStorageProvider implements StorageProvider {
  readonly name = "telegram";
  private readonly peer: Api.InputPeerChannel;
  private readonly title: string | null;

  constructor(
    private readonly client: TelegramClient,
    options: TelegramStorageOptions,
  ) {
    this.peer = new Api.InputPeerChannel({
      channelId: bigInt(options.chatId),
      accessHash: bigInt(options.accessHash),
    });
    this.title = options.title ?? null;
  }

  // ── Upload ───────────────────────────────────────────────────────────────

  async put(input: StorageUploadInput, control: TransferControl = {}): Promise<StoredObject> {
    const total = input.data ? input.data.byteLength : input.size;
    if (total === undefined || (!input.data && !input.path)) {
      throw new UploadFailedError("Upload input has neither data nor a spooled file");
    }
    if (total > MAX_DOCUMENT_BYTES) {
      throw new UploadFailedError(
        `Telegram does not accept documents larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024 * 1024)} GB`,
      );
    }
    this.throwIfAborted(control.signal);

    control.onProgress?.({ transferred: 0, total, percent: 0 });

    try {
      // A spooled file is handed to GramJS by path, so it reads the parts it
      // needs from disk; an in-memory buffer is passed through unchanged.
      const file = input.data
        ? new CustomFile(input.name, total, "", input.data)
        : new CustomFile(input.name, total, input.path!);
      const message = await this.client.sendFile(this.peer, {
        file,
        forceDocument: true,
        workers: 1,
        // Surface transport-level progress to the caller. GramJS reports a
        // 0..1 fraction. `isCanceled` lets us abort an in-flight upload.
        progressCallback: Object.assign(
          (fraction: number) => {
            const clamped = Math.max(0, Math.min(1, fraction));
            control.onProgress?.({
              transferred: Math.round(clamped * total),
              total,
              percent: Math.round(clamped * 100),
            });
          },
          {
            get isCanceled(): boolean {
              return control.signal?.aborted === true;
            },
          },
        ),
      });

      if (!(message instanceof Api.Message)) {
        throw new UploadFailedError("Telegram returned an unexpected upload response");
      }

      control.onProgress?.({ transferred: total, total, percent: 100 });
      return {
        messageId: message.id.toString(),
        name: input.name,
        size: total,
        mimeType: input.mimeType,
      };
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      throw mapTelegramError(error, "Telegram upload failed");
    }
  }

  // ── Download ─────────────────────────────────────────────────────────────

  async get(ref: StoredRef, control: TransferControl = {}): Promise<Buffer> {
    const message = await this.requireMessage(ref);
    this.throwIfAborted(control.signal);

    const size = this.documentSize(message);
    control.onProgress?.({ transferred: 0, total: size, percent: 0 });

    let data: Buffer | string | undefined;
    try {
      data = await this.client.downloadMedia(message, {
        progressCallback: (downloaded: bigInt.BigInteger, total: bigInt.BigInteger) => {
          const transferred = Number(downloaded.toString());
          const totalBytes = Number(total.toString());
          control.onProgress?.({
            transferred,
            total: totalBytes,
            percent: totalBytes > 0 ? Math.round((transferred / totalBytes) * 100) : null,
          });
        },
      });
    } catch (error) {
      throw mapTelegramError(error, "Telegram download failed");
    }

    if (!data || typeof data === "string") {
      throw new TelegramFileNotFoundError("Telegram did not return file content");
    }
    const buffer = Buffer.from(data);
    control.onProgress?.({
      transferred: buffer.byteLength,
      total: buffer.byteLength,
      percent: 100,
    });
    return buffer;
  }

  /**
   * Streams the object in Telegram-sized chunks, so memory use stays bounded
   * by one chunk regardless of file size. The first request happens here so
   * that a missing message fails before the caller starts consuming bytes.
   */
  async getStream(ref: StoredRef, control: TransferControl = {}): Promise<Readable> {
    const message = await this.requireMessage(ref);
    this.throwIfAborted(control.signal);

    const size = this.documentSize(message);
    const media = message.media;
    if (size === null || !media) {
      throw new TelegramFileNotFoundError("Telegram did not return file content");
    }

    const iterator = this.client.iterDownload({
      file: media,
      fileSize: bigInt(size),
      requestSize: DOWNLOAD_CHUNK_BYTES,
    });

    let transferred = 0;
    control.onProgress?.({ transferred: 0, total: size, percent: 0 });

    const signal = control.signal;
    return Readable.from(
      (async function* () {
        try {
          for await (const chunk of iterator) {
            if (signal?.aborted) throw new OperationCancelledError();
            const buffer = Buffer.from(chunk);
            transferred += buffer.byteLength;
            control.onProgress?.({
              transferred,
              total: size,
              percent: size > 0 ? Math.round((transferred / size) * 100) : null,
            });
            yield buffer;
          }
        } catch (error) {
          if (error instanceof OperationCancelledError) throw error;
          throw mapTelegramError(error, "Telegram download failed");
        }
      })(),
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

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

  /**
   * Read-only listing of stored documents in the channel, newest first, up to
   * `limit`. Only messages that carry a document are returned; text messages and
   * service messages are skipped. Nothing is modified.
   */
  async listObjects(limit: number): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    try {
      for await (const message of this.client.iterMessages(this.peer, { limit: limit * 2 })) {
        if (objects.length >= limit) break;
        if (!(message instanceof Api.Message)) continue;
        const document = message.document;
        if (!(document instanceof Api.Document)) continue;
        let fileName: string | undefined;
        for (const attr of document.attributes) {
          if (attr instanceof Api.DocumentAttributeFilename) {
            fileName = attr.fileName;
            break;
          }
        }
        objects.push({
          messageId: message.id.toString(),
          name: fileName ?? "file",
          size: Number(document.size.toString()),
          mimeType: document.mimeType,
        });
      }
    } catch (error) {
      throw mapTelegramError(error, "Telegram listing failed");
    }
    return objects;
  }

  async stat(ref: StoredRef): Promise<StoredObject | null> {
    const message = await this.getMessage(ref.messageId);
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

  // ── Health ───────────────────────────────────────────────────────────────

  /**
   * Validates that the client is connected and the storage channel is
   * reachable (a real Telegram round-trip on the channel peer).
   */
  async healthCheck(): Promise<StorageHealth> {
    const startedAt = Date.now();
    try {
      if (!this.client.connected) {
        return {
          healthy: false,
          latencyMs: null,
          message: "Telegram client is not connected",
          targetTitle: this.title,
        };
      }
      const result = await this.client.invoke(
        new Api.channels.GetFullChannel({ channel: this.peer }),
      );
      const title =
        result instanceof Api.messages.ChatFull && result.chats[0] instanceof Api.Channel
          ? result.chats[0].title
          : this.title;
      return {
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message: null,
        targetTitle: title ?? null,
      };
    } catch (error) {
      const mapped = mapTelegramError(error, "Telegram storage health check failed");
      return {
        healthy: false,
        latencyMs: Date.now() - startedAt,
        message: mapped.message,
        targetTitle: this.title,
      };
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new OperationCancelledError();
    if (!this.client.connected) {
      throw new TelegramConnectionError("Telegram client is not connected");
    }
  }

  private documentSize(message: Api.Message): number | null {
    const document = message.document;
    if (document instanceof Api.Document) return Number(document.size.toString());
    return null;
  }

  private async requireMessage(ref: StoredRef): Promise<Api.Message> {
    const message = await this.getMessage(ref.messageId);
    if (!message?.media) {
      throw new TelegramFileNotFoundError();
    }
    return message;
  }

  private async getMessage(id: string): Promise<Api.Message | undefined> {
    try {
      const messages = await this.client.getMessages(this.peer, { ids: [Number(id)] });
      const first = messages[0];
      return first instanceof Api.Message ? first : undefined;
    } catch (error) {
      if (error instanceof TelegramAuthRequiredError) throw error;
      throw mapTelegramError(error, "Telegram lookup failed");
    }
  }
}
