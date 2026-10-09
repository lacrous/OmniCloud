import { beforeAll, describe, expect, it } from "vitest";
import { ActivityService } from "../src/services/activity-service";
import { FileService } from "../src/services/file-service";
import { FolderService } from "../src/services/folder-service";
import { StorageEngine } from "../src/storage/engine";
import { FakeStorageProvider, createInMemoryRepos, makeUser, type InMemoryRepos } from "./fakes";

/**
 * Opt-in volume check at the sizes the hardening plan names. It is skipped in
 * the normal suite because it takes minutes. Run it with:
 *
 *   OMNICLOUD_VOLUME_FILES=5000 pnpm --filter @omnicloud/core test stress-volume
 */
const FILES = Number(process.env.OMNICLOUD_VOLUME_FILES ?? 0);
const FOLDERS = Number(process.env.OMNICLOUD_VOLUME_FOLDERS ?? 200);
const CONCURRENCY = Number(process.env.OMNICLOUD_VOLUME_CONCURRENCY ?? 20);

describe.skipIf(FILES <= 0)(`volume: ${FILES} files, ${FOLDERS} folders`, () => {
  let repos: InMemoryRepos;
  let provider: FakeStorageProvider;
  let files: FileService;
  let folders: FolderService;
  let user: ReturnType<typeof makeUser>;

  beforeAll(() => {
    repos = createInMemoryRepos();
    provider = new FakeStorageProvider();
    provider.latencyMs = 0;
    const engine = new StorageEngine(provider, { attempts: 2, baseDelayMs: 0 });
    const engineFor = async () => engine;
    const activity = new ActivityService(repos.activity);
    files = new FileService(
      repos.files,
      repos.folders,
      engineFor,
      activity,
      repos.uploadOperations,
    );
    folders = new FolderService(repos.folders, repos.files, engineFor, activity);
    user = makeUser();
  });

  it(
    "creates the folders, uploads every file, and keeps counts consistent",
    async () => {
      const folderIds: string[] = [];
      for (let i = 0; i < FOLDERS; i += 1) {
        const folder = await folders.create(user.id, { name: `f${i}`, parentId: null });
        folderIds.push(folder.id);
      }

      let next = 0;
      const started = Date.now();
      const worker = async () => {
        while (next < FILES) {
          const i = next;
          next += 1;
          await files.upload(user.id, {
            folderId: folderIds[i % FOLDERS] ?? null,
            name: `v${i}.txt`,
            data: Buffer.from(`content-${i}`),
          });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      const seconds = (Date.now() - started) / 1000;

      expect(repos._files).toHaveLength(FILES);
      expect(provider.objects.size).toBe(FILES);
      const seen = new Set(repos._files.map((f) => f.name));
      expect(seen.size).toBe(FILES);
      console.log(
        `volume: ${FILES} uploads in ${seconds.toFixed(1)}s (${(FILES / seconds).toFixed(0)}/s)`,
      );
    },
    30 * 60 * 1000,
  );
});
