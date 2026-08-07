import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import type React from "react";
import {
  ErrorComponent,
  NotFoundComponent,
  RootComponent,
  RootShell,
} from "../app/root-presentation";
import { rootHead, rootLoader } from "../app/root-route-config";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: rootLoader,
    head: rootHead,
    shellComponent: RootShellAdapter,
    component: RootComponentAdapter,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShellAdapter({ children }: { children: React.ReactNode }) {
  return (
    <RootShell locale={Route.useLoaderData().locale}>{children}</RootShell>
  );
}

function RootComponentAdapter() {
  return (
    <RootComponent
      queryClient={Route.useRouteContext().queryClient}
      loaderData={Route.useLoaderData()}
    />
  );
}
