import type { WorkspaceData } from "./types";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "./types";

/**
 * Создаёт чистое рабочее пространство без предустановленных источников,
 * тестовых новостей и демонстрационных черновиков.
 */
export function createEmptyWorkspace(): WorkspaceData {
  return {
    schemaVersion: SCHEMA_VERSION,
    sources: [],
    articles: [],
    drafts: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function createSeedWorkspace(): WorkspaceData {
  return createEmptyWorkspace();
}
