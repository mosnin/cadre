"use client";

import { PanelLeftIcon, X } from "lucide-react";
import type * as React from "react";
import { Button } from "../components/ui/button";
import { AppBrand } from "./app-brand";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "./sidebar";

export function AppSidebar({
  navigation,
  children,
  footer,
  headerActions,
  /** Sits on the brand's row, as the reference puts the workspace there. */
  headerTitle,
  closeLabel,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  navigation: React.ReactNode;
  footer: React.ReactNode;
  headerActions?: React.ReactNode;
  headerTitle?: React.ReactNode;
  closeLabel: string;
}) {
  return (
    <Sidebar collapsible="none" {...props}>
      {/* Insets measured off the reference: 12px at the head, 8px down the
          list, 12px in the footer. The app had 20/12/16. */}
      <SidebarHeader className="gap-3 px-3 pb-2 pt-3 md:gap-2">
        <SidebarHeaderContent closeLabel={closeLabel} actions={headerActions} title={headerTitle} />
        {navigation}
      </SidebarHeader>
      <SidebarContent className="px-3 pb-3">{children}</SidebarContent>
      <SidebarFooter className="px-3 pb-3">{footer}</SidebarFooter>
    </Sidebar>
  );
}

// Renders the sidebar header per state: mobile drawer, collapsed (icon-only), and expanded.
// Each branch returns its own layout and controls.
function SidebarHeaderContent({
  closeLabel,
  actions,
  title,
}: {
  closeLabel: string;
  actions?: React.ReactNode;
  title?: React.ReactNode;
}) {
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  if (isMobile) {
    return (
      <div className="flex min-h-11 items-center gap-2">
        <AppBrand className="ml-1 size-7" />
        {title ? <div className="min-w-0 flex-1">{title}</div> : null}

        <div className="ms-auto flex items-center gap-2">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => setOpenMobile(false)}
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <div className="flex h-8 items-center justify-start">
        {/* On hover the brand fades out and the expand icon fades in (RTL-flipped). */}
        <button
          type="button"
          className="group flex size-8 items-center justify-center transition-colors"
          onClick={() => toggleSidebar()}
          aria-label="Expand sidebar"
        >
          <div className="relative flex size-8 items-center justify-center">
            <AppBrand className="transition-opacity group-hover:opacity-0" size={20} />
            <PanelLeftIcon className="cn-rtl-flip absolute size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-11 items-center gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <AppBrand className="ml-1 size-7 md:size-5" />
      </div>
      {title ? <div className="min-w-0 flex-1">{title}</div> : null}

      <div className="ms-auto flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground md:hidden"
          onClick={() => toggleSidebar()}
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </Button>

        {actions}
        <SidebarTrigger
          aria-label={closeLabel}
          className="hidden size-11 text-muted-foreground md:flex"
        />
      </div>
    </div>
  );
}
