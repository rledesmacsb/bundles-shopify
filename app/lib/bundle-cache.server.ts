import { createHash } from "node:crypto";

import {
  loadBundleDiagnostics,
  type BundleDiagnostics,
} from "./bundle-diagnostics.server";

import {
  loadPcMonitorBundleData,
  type PcMonitorBundleData,
} from "./bundle-data.server";

import {
  loadExistingPcMonitorBundleMatches,
  type ExistingBundleLookupResult,
} from "./bundle-existing.server";

import {
  loadBundleRuntimeSettings,
  type BundleRuntimeSettings,
} from "./bundle-runtime-settings.server";

import {
  loadBundleTemplateCatalog,
  type BundleTemplateCatalogData,
} from "./bundle-template-catalog.server";

import {
  loadBundleTemplateSettings,
} from "./bundle-templates.server";

import {
  loadBundleReadiness,
  type BundleReadiness,
} from "./bundle-readiness.server";

import type {
  TemplateBundleCandidate,
} from "./bundle-template-engine";

type AdminClient = {
  graphql: (
    query: string,
    options?: any,
  ) => Promise<any>;
};

type CacheEntry = {
  expiresAt: number;
  value?: unknown;
  pending?: Promise<unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var csbyteBundleRuntimeCache:
    | Map<string, CacheEntry>
    | undefined;
}

const cache =
  global.csbyteBundleRuntimeCache ??
  new Map<string, CacheEntry>();

global.csbyteBundleRuntimeCache =
  cache;

const CATALOG_TTL_MS =
  30_000;

const SETTINGS_TTL_MS =
  30_000;

const DIAGNOSTICS_TTL_MS =
  20_000;

const LEGACY_DATA_TTL_MS =
  30_000;

const EXISTING_BUNDLES_TTL_MS =
  12_000;

const READINESS_TTL_MS =
  15_000;

function cleanupExpiredEntries() {
  if (
    cache.size <
    80
  ) {
    return;
  }

  const now =
    Date.now();

  for (
    const [
      key,
      entry,
    ]
    of cache
  ) {
    if (
      !entry.pending &&
      entry.expiresAt <=
        now
    ) {
      cache.delete(
        key,
      );
    }
  }
}

async function readThroughCache<T>(
  key:
    string,

  ttlMs:
    number,

  loader:
    () => Promise<T>,
): Promise<T> {
  cleanupExpiredEntries();

  const now =
    Date.now();

  const current =
    cache.get(
      key,
    );

  if (
    current?.value !==
      undefined &&
    current.expiresAt >
      now
  ) {
    return current
      .value as T;
  }

  if (
    current?.pending
  ) {
    return current
      .pending as Promise<T>;
  }

  const pending =
    loader()
      .then(
        (
          value,
        ) => {
          cache.set(
            key,
            {
              value,
              expiresAt:
                Date.now() +
                ttlMs,
            },
          );

          return value;
        },
      )
      .catch(
        (
          error,
        ) => {
          cache.delete(
            key,
          );

          throw error;
        },
      );

  cache.set(
    key,
    {
      pending,
      expiresAt:
        0,
    },
  );

  return pending;
}

function shopKey(
  shop:
    string,
) {
  return shop
    .trim()
    .toLowerCase();
}

function candidateSignature(
  candidates:
    TemplateBundleCandidate[],
) {
  const compact =
    candidates.map(
      (
        candidate,
      ) => [
        candidate.id,
        candidate.templateId,
        candidate.identity.sku,
        candidate.baseProduct.id,
        candidate.monitor.id,
        candidate.keyboardMouse.id,
        candidate.wifiAdapter
          ?.id ??
          "",
      ],
    );

  return createHash(
    "sha1",
  )
    .update(
      JSON.stringify(
        compact,
      ),
    )
    .digest(
      "hex",
    )
    .slice(
      0,
      16,
    );
}

export function invalidateShopBundleCache(
  shop:
    string,
) {
  const prefix =
    `bundle:${shopKey(
      shop,
    )}:`;

  for (
    const key
    of cache.keys()
  ) {
    if (
      key.startsWith(
        prefix,
      )
    ) {
      cache.delete(
        key,
      );
    }
  }
}

export function loadCachedBundleTemplateCatalog(
  admin:
    AdminClient,

  shop:
    string,
): Promise<BundleTemplateCatalogData> {
  return readThroughCache(
    `bundle:${shopKey(
      shop,
    )}:catalog`,

    CATALOG_TTL_MS,

    () =>
      loadBundleTemplateCatalog(
        admin,
      ),
  );
}

export function loadCachedBundleRuntimeSettings(
  admin:
    AdminClient,

  shop:
    string,
): Promise<BundleRuntimeSettings> {
  return readThroughCache(
    `bundle:${shopKey(
      shop,
    )}:runtime-settings`,

    SETTINGS_TTL_MS,

    () =>
      loadBundleRuntimeSettings(
        admin,
      ),
  );
}

export function loadCachedBundleDiagnostics(
  admin:
    AdminClient,

  shop:
    string,
): Promise<BundleDiagnostics> {
  return readThroughCache(
    `bundle:${shopKey(
      shop,
    )}:diagnostics`,

    DIAGNOSTICS_TTL_MS,

    () =>
      loadBundleDiagnostics(
        admin,
      ),
  );
}

export function loadCachedPcMonitorBundleData(
  admin:
    AdminClient,

  shop:
    string,
): Promise<PcMonitorBundleData> {
  return readThroughCache(
    `bundle:${shopKey(
      shop,
    )}:legacy-data`,

    LEGACY_DATA_TTL_MS,

    () =>
      loadPcMonitorBundleData(
        admin,
      ),
  );
}

export function loadCachedBundleTemplateSettings(
  admin:
    AdminClient,

  shop:
    string,
): ReturnType<
  typeof loadBundleTemplateSettings
> {
  return readThroughCache(
    `bundle:${shopKey(
      shop,
    )}:template-settings`,

    SETTINGS_TTL_MS,

    () =>
      loadBundleTemplateSettings(
        admin,
      ),
  );
}

export function loadCachedExistingBundleMatches(
  admin:
    AdminClient,

  shop:
    string,

  candidates:
    TemplateBundleCandidate[],
): Promise<ExistingBundleLookupResult> {
  const signature =
    candidateSignature(
      candidates,
    );

  return readThroughCache(
    `bundle:${shopKey(
      shop,
    )}:existing:${signature}`,

    EXISTING_BUNDLES_TTL_MS,

    () =>
      loadExistingPcMonitorBundleMatches(
        admin,
        candidates,
      ),
  );
}

/**
 * Targeted, short-lived Shopify lookup for the actual bundle components.
 * Invalidated with the rest of the app cache after a bundle mutation.
 */
export function loadCachedBundleReadiness(
  admin: AdminClient,
  shop: string,
  candidates: TemplateBundleCandidate[],
): Promise<BundleReadiness> {
  const signature = candidateSignature(candidates);
  return readThroughCache(
    `bundle:${shopKey(shop)}:readiness:${signature}`,
    READINESS_TTL_MS,
    () => loadBundleReadiness(admin, candidates),
  );
}
