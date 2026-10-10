import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import {
  captureBrowserException,
  initializeBrowserErrorMonitoring,
  shouldCaptureBrowserError,
} from "./lib/error-monitoring.ts";
import { ignoreStaleChunkPrefetchErrors } from "./lib/stale-chunk.ts";

const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";

// リリース後に開いたままのタブが、裏の先読みで前の版のファイルを取れなくてもエラーにしない (stale-chunk.ts)
ignoreStaleChunkPrefetchErrors();

initializeBrowserErrorMonitoring({
  dsn: meta("sentry-dsn"),
  environment: meta("sentry-environment") || "production",
  release: meta("app-version") || "dev",
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter
        onError={(error) => {
          if (shouldCaptureBrowserError(error)) captureBrowserException(error);
        }}
      />
    </StrictMode>,
  );
});
