import { useSessionJumpHints } from "./useSessionJumpHints";
import { markCustomMenu, menuKeys } from "./menuKeys";
import { createPortal } from "react-dom";
import { Select } from "./Select";
import { copyText } from "./clipboard";
import {
  CaretDown,
	CaretRight,
  Check,
	Copy,
  DotsThree,
  Folder,
  GitBranch,
  House,
  ListMagnifyingGlass,
  Plus,
	PencilSimple,
	PushPin,
  Archive,
  ArrowLeft,
  Robot,
  SidebarSimple,
  Gear,
  SquaresFour,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProviderIcon } from "./ProviderIcon";
import {
  deleteSession,
  ExternalConversation,
  projectName,
  relativeTime,
  removeProject,
  renameProject,
  renameSession,
  Session,
} from "./api";
import { refreshEngine } from "./engine-store";
import {
  Preferences,
  ProjectOrganization,
  ProjectSort,
  SidebarSection,
} from "./preferences";

export type Page =
  | "home"
  | "sites"
  | "sessions"
  | "agents"
  | "review"
  | "settings";

type SidebarItem =
  | { kind: "session"; updatedAt: string; session: Session }
  | { kind: "external"; updatedAt: string; conversation: ExternalConversation };

export function Sidebar({
  page,
  sessions,
  allSessions,
  projects,
  projectNames,
  externalConversations,
  projectOrganization,
  projectSort,
  resumingConversationId,
  selectedId,
  connected,
  onPage,
  onOpen,
  onResumeExternal,
  onProjectOrganization,
  onProjectSort,
  onSearch,
  onNewProject,
  onNewSession,
  onToggle,
  onArchive,
  preferences,
  onPreferences,
  onBeforeDelete,
  onDeleted,
}: {
  preferences: Preferences;
  onPreferences: (next: Preferences) => void;
  page: Page;
  sessions: Session[];
  allSessions: Session[];
  projects: string[];
  projectNames: Record<string, string>;
  externalConversations: ExternalConversation[];
  projectOrganization: ProjectOrganization;
  projectSort: ProjectSort;
  resumingConversationId: string | null;
  selectedId: string | null;
  connected: boolean;
  onPage: (page: Page) => void;
  onOpen: (id: string) => void;
  onResumeExternal: (conversation: ExternalConversation) => void;
  onProjectOrganization: (organization: ProjectOrganization) => void;
  onProjectSort: (sort: ProjectSort) => void;
  onNewProject: () => void;
  onSearch: () => void;
  onNewSession: () => void;
  onToggle: () => void;
  onArchive: (id: string, archived: boolean) => Promise<boolean>;
  onBeforeDelete: (sessionIDs: string[]) => string | null;
  onDeleted: (id: string) => void;
}) {
  const jumpHints = useSessionJumpHints(allSessions.filter(session=>!session.parent_session_id), preferences);
  const [contextPosition, setContextPosition] = useState({
    left: 12,
    top: 100,
  });
  const contextAnchor = useRef({left:12,top:100});
  const [context, setContext] = useState<Session | null>(null);
  const [projectContext, setProjectContext] = useState<string | null>(null);
  const [sectionMenu, setSectionMenu] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const chatContextID = useRef<string | null>(null);
  const chatMenuFocus = useRef<"first" | "copy" | "back">("first");
  const [menuError, setMenuError] = useState("");
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<{
    kind:
      | "section"
      | "new-section"
      | "project"
      | "remove-project"
      | "session"
      | "delete-session";
    value: string;
    target: string;
    sessionIDs?: string[];
    displayName?: string;
  } | null>(null);
  const [mutation, setMutation] = useState({ busy: false, error: "" });
  const [notice, setNotice] = useState("");
  const expandedInitialized = useRef(projects.length > 0);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(projects.slice(0, 3)),
  );
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(true);
  const [archivedShown, setArchivedShown] = useState(10);
  const projectsCollapsed = false;
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const viewTrigger = useRef<HTMLButtonElement>(null);
  const newSessionTrigger = useRef<HTMLButtonElement>(null);
  const contextTrigger = useRef<HTMLButtonElement | null>(null);
  const projectContextTrigger = useRef<HTMLElement | null>(null);
  const sectionContextTrigger = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const pendingFocusID = useRef<string | null>(null);
  const membershipRef = useRef(preferences.session_sections);
  membershipRef.current = preferences.session_sections;
  const [viewBounds, setViewBounds] = useState({ left: 0, top: 0 });
  const setContextAnchor=(left:number,top:number)=>{contextAnchor.current={left,top};setContextPosition({left,top});};
  useLayoutEffect(() => {
    if (!projectMenuOpen) return;
    const place = () => {
      const r = viewTrigger.current!.getBoundingClientRect();
      setViewBounds({
        left:
          r.right + 238 < window.innerWidth
            ? r.right + 6
            : Math.max(8, r.left - 238),
        top: Math.max(8, Math.min(r.top, window.innerHeight - 280)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [projectMenuOpen, preferences.sidebar_width]);

  useEffect(() => {
    if (projectMenuOpen)
      document.querySelector<HTMLElement>(".sidebar-view-menu button")?.focus();
  }, [projectMenuOpen]);
  useEffect(() => {
    if (sectionMenu || projectContext)
      document
        .querySelector<HTMLElement>(
          sectionMenu
            ? ".section-context-menu button"
            : ".project-context-menu button",
        )
        ?.focus();
  }, [sectionMenu, projectContext]);
  useLayoutEffect(() => {
    if (!context) {
      chatContextID.current = null;
      return;
    }
    if (chatContextID.current === context.id) return;
    chatContextID.current = context.id;
    chatMenuFocus.current = "first";
    setCopyOpen(false);
    setMenuError("");
  }, [context?.id]);
  useLayoutEffect(() => {
    if (!context) return;
    const target = copyOpen
      ? ".sidebar-session-menu [data-copy-back]"
      : chatMenuFocus.current === "copy"
        ? ".sidebar-session-menu [data-copy-trigger]"
        : ".sidebar-session-menu [data-chat-menu-first]";
    document.querySelector<HTMLElement>(target)?.focus();
  }, [context?.id, copyOpen]);
  useEffect(() => {
    if (dialog) {
      const releaseMenu = markCustomMenu(dialogRef.current);
      if (
        !dialogOpener.current &&
        document.activeElement instanceof HTMLElement
      )
        dialogOpener.current = document.activeElement;
      window.setTimeout(() =>
        (dialogRef.current?.querySelector<HTMLElement>("input")??dialogRef.current
          ?.querySelector<HTMLElement>("button:not(:disabled):not([aria-label='Close dialog'])"))
          ?.focus(),
      );
      return releaseMenu;
    }
  }, [dialog?.kind, dialog?.target]);
  useLayoutEffect(()=>{if(!context&&!projectContext&&!sectionMenu)return;const card=document.querySelector<HTMLElement>(sectionMenu?".section-context-menu":projectContext?".project-context-menu":".sidebar-session-menu");if(!card)return;const reposition=()=>{const bounds=card.getBoundingClientRect(),anchor=contextAnchor.current;setContextPosition({left:Math.max(8,Math.min(anchor.left,window.innerWidth-bounds.width-8)),top:Math.max(8,Math.min(anchor.top,window.innerHeight-bounds.height-8))});};reposition();window.addEventListener("resize",reposition);window.addEventListener("scroll",reposition,true);return()=>{window.removeEventListener("resize",reposition);window.removeEventListener("scroll",reposition,true);};},[context,projectContext,sectionMenu,copyOpen]);
  useEffect(() => {
    if (projectMenuOpen || context || projectContext || sectionMenu)
      return markCustomMenu(projectMenuRef.current);
  }, [
    projectMenuOpen,
    Boolean(context),
    Boolean(projectContext),
    Boolean(sectionMenu),
  ]);
  useEffect(() => {
    const dismiss = () => {
      setProjectMenuOpen(false);
      setContext(null);
      setProjectContext(null);
    };
    window.addEventListener("openade-dismiss-menus", dismiss);
    return () => window.removeEventListener("openade-dismiss-menus", dismiss);
  }, []);
  const allItems = useMemo<SidebarItem[]>(
    () => [
      ...sessions
        .filter(
          (session) =>
            !preferences.pinned_sessions.includes(session.id) &&
            !preferences.session_sections[session.id] &&
            `${session.title} ${session.repo_root}`
              .toLowerCase()
              .includes(filter.toLowerCase()),
        )
        .map((session) => ({
          kind: "session" as const,
          updatedAt: session.updated_at,
          session,
        })),
      ...externalConversations
        .filter((conversation) =>
          `${conversation.title} ${conversation.project_root}`
            .toLowerCase()
            .includes(filter.toLowerCase()),
        )
        .map((conversation) => ({
          kind: "external" as const,
          updatedAt: conversation.updated_at,
          conversation,
        })),
    ],
    [
      externalConversations,
      sessions,
      preferences.pinned_sessions,
      preferences.session_sections,
      filter,
    ],
  );
  const filteredSidebarSessions=sessions.filter(session=>!preferences.sidebar_project_filter||session.repo_root===preferences.sidebar_project_filter);

  const projectLabel = (root:string) => projectNames[root] || projectName(root);
  const orderIndex = (item: SidebarItem) => {
    const index = preferences.session_order.indexOf(itemKey(item));
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const grouped = useMemo(() => {
    const roots = [
      ...new Set([
        ...projects,
        ...sessions.map((session) => session.repo_root),
        ...externalConversations.map(
          (conversation) => conversation.project_root,
        ),
      ]),
    ];
    const groups = roots.map((root) => ({
      root,
      items: sortSidebarItems(
        allItems.filter((item) => itemRoot(item) === root),
        projectSort,
      ).sort((a, b) =>
        projectSort === "manual" ? orderIndex(a) - orderIndex(b) : 0,
      ),
    }));
    if (projectSort === "manual") return groups;
    return groups.sort((left, right) => {
      const leftFirst = left.items[0];
      const rightFirst = right.items[0];
      if (leftFirst && rightFirst) {
        const compared = compareSidebarItems(
          leftFirst,
          rightFirst,
          projectSort,
        );
        if (compared) return compared;
      }
      if (leftFirst) return -1;
      if (rightFirst) return 1;
      return projectLabel(left.root).localeCompare(projectLabel(right.root));
    });
  }, [
    allItems,
    externalConversations,
    projectSort,
    projects,
    sessions,
    preferences.session_order,
    projectNames,
  ]);

  const sortedItems = useMemo(
    () =>
      sortSidebarItems(allItems, projectSort).sort((a, b) =>
        projectSort === "manual" ? orderIndex(a) - orderIndex(b) : 0,
      ),
    [allItems, projectSort, preferences.session_order],
  );
  const archivedItems = useMemo(
    () => {
      const rows = sortSidebarItems(
        allSessions
          .filter(
            (session) =>
              session.archived &&
              (!preferences.sidebar_project_filter ||
                session.repo_root === preferences.sidebar_project_filter),
          )
          .map((session) => ({
            kind: "session" as const,
            updatedAt: session.updated_at,
            session,
          })),
        projectSort,
      ).filter((item): item is Extract<SidebarItem, { kind: "session" }> =>
        item.kind === "session",
      );
      return rows.sort((left, right) =>
        projectSort === "manual" ? orderIndex(left) - orderIndex(right) : 0,
      );
    },
    [allSessions, projectSort, preferences.session_order, preferences.sidebar_project_filter],
  );
  const visibleArchivedItems = archivedItems.slice(0, archivedShown);
  const filteredGroups = grouped.filter(
    (group) =>
      !preferences.sidebar_project_filter ||
      group.root === preferences.sidebar_project_filter,
  );
  const visibleGroups = showAllProjects
    ? filteredGroups
    : filteredGroups.slice(0, 10);
  const filteredItems = sortedItems.filter(
    (item) =>
      !preferences.sidebar_project_filter ||
      itemRoot(item) === preferences.sidebar_project_filter,
  );
  const visibleFlatItems = showAllProjects
    ? filteredItems
    : filteredItems.slice(0, 10);

  useEffect(() => {
    if (!expandedInitialized.current && grouped.length) {
      expandedInitialized.current = true;
      setExpanded(new Set(grouped.slice(0, 3).map((group) => group.root)));
    }
  }, [grouped]);

  useEffect(() => {
    if (!projectMenuOpen && !context && !projectContext && !sectionMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        !projectMenuRef.current?.contains(event.target as Node) &&
        !(event.target as Element).closest(".project-menu-wrap,.select-popover")
      )
        setProjectMenuOpen(false);
      if (
        !(event.target as Element).closest(
          ".sidebar-session-menu,.select-popover",
        )
      )
        setContext(null);
      if (!(event.target as Element).closest(".project-context-menu"))
        setProjectContext(null);
      if (!(event.target as Element).closest(".section-context-menu"))
        setSectionMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        setProjectMenuOpen(false);
        if (context) {
          setContext(null);
          contextTrigger.current?.focus();
        } else if (projectContext) {
          setProjectContext(null);
          projectContextTrigger.current?.focus();
        } else if (sectionMenu) {
          setSectionMenu(null);
          sectionContextTrigger.current?.focus();
        } else viewTrigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [projectMenuOpen, context, projectContext, sectionMenu]);

  const toggle = (root: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });

  const chooseOrganization = (organization: ProjectOrganization) => {
    onProjectOrganization(organization);
    setShowAllProjects(false);
  };

  const chooseSort = (sort: ProjectSort) => {
    onProjectSort(sort);
  };

  const sections = (next: SidebarSection[]) =>
    onPreferences({ ...preferences, sidebar_sections: next });
  const openRemove = (root: string) => {
    dialogOpener.current = projectContextTrigger.current;
    setDialog({
      kind: "remove-project",
      target: root,
      value: "",
      sessionIDs: allSessions
        .filter((session) => session.repo_root === root)
        .map((session) => session.id)
        .sort(),
      displayName: label(root),
    });
  };
  const setMembership = (id: string, sectionId: string) => {
    const memberships = { ...membershipRef.current };
    if (sectionId) memberships[id] = sectionId;
    else delete memberships[id];
    membershipRef.current = memberships;
    onPreferences({
      ...preferences,
      session_sections: memberships,
      pinned_sessions: sectionId
        ? preferences.pinned_sessions.filter((value) => value !== id)
        : preferences.pinned_sessions,
    });
  };
  const archive = (id: string) => {
    void onArchive(id, !allSessions.find(session => session.id === id)?.archived);
    setContext(null);
  };
  const archiveSection = (sectionID: string) => {
    const ids = allSessions
      .filter(
        (session) => preferences.session_sections[session.id] === sectionID,
      )
      .map((session) => session.id);
    void Promise.all(ids.map(id => onArchive(id, true)));
  };
  const deleteSection = (sectionID: string) =>
    onPreferences({
      ...preferences,
      sidebar_sections: preferences.sidebar_sections.filter(
        (section) => section.id !== sectionID,
      ),
      session_sections: Object.fromEntries(
        Object.entries(preferences.session_sections).filter(
          ([, value]) => value !== sectionID,
        ),
      ),
    });
  const label = projectLabel;
  const sessionButton = (session: Session) => (
    <button
      ref={(node) => {
        if (node && pendingFocusID.current === session.id) {
          pendingFocusID.current = null;
          node.focus();
        }
      }}
      data-session-id={session.id}
      draggable
      className={`sidebar-chat-row ${selectedId === session.id ? "active" : ""} ${preferences.sidebar_show_provider ? "" : "hide-provider"}`}
      key={session.id}
      onClick={() => onOpen(session.id)}
      onDragStart={(event)=>{event.stopPropagation();event.dataTransfer.setData("text/openade-session-id",session.id);event.dataTransfer.setData("text/openade-session",`session:${session.id}`);}}
      aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
      aria-description="Alt Shift Up or Down moves this chat between sections."
      onKeyDown={(event)=>{if(!event.altKey||!event.shiftKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const targets=["",...preferences.sidebar_sections.map(section=>section.id)];const current=targets.indexOf(membershipRef.current[session.id]??"");const next=(current+(event.key==='ArrowUp'?-1:1)+targets.length)%targets.length;pendingFocusID.current=session.id;setMembership(session.id,targets[next]);window.requestAnimationFrame(()=>{document.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(session.id)}"]`)?.focus();pendingFocusID.current=null;});}}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        contextTrigger.current = event.currentTarget;
        setContextAnchor(event.clientX,event.clientY);
        setContext(session);
      }}
      title={session.title}
    >
      <span className={`status-dot ${session.status}`} />
      <ProviderIcon provider={session.agent} />
      <span>
        {preferences.sidebar_show_project_label && (
          <em className="project-metadata">
            {label(session.repo_root)} @ Local
          </em>
        )}
        {session.title}
        {preferences.sidebar_show_branch && (
          <em className="branch-metadata">{session.branch}</em>
        )}
        {preferences.sidebar_show_pr && session.pr_url && <em>Pull request</em>}
      </span>
      <small
        className={jumpHints[session.id] ? "session-jump-hint" : ""}
        aria-label={
          jumpHints[session.id]
            ? `Shortcut ${jumpHints[session.id]}`
            : undefined
        }
      >
        {jumpHints[session.id] || relativeTime(session.updated_at)}
      </small>
    </button>
  );
  const move = (from: string, to: string) => {
    const order = [
      ...new Set([...preferences.session_order, ...allItems.map(itemKey)]),
    ];
    order.splice(order.indexOf(from), 1);
    order.splice(order.indexOf(to), 0, from);
    onPreferences({
      ...preferences,
      session_order: order,
      project_sort: "manual",
    });
  };
  const restoreDialogFocus = (closingDialog = dialog, removed = false) => {
    const opener = removed ? null : dialogOpener.current;
    dialogOpener.current = null;
    const kind = closingDialog?.kind;
    const fallbacks: Array<HTMLElement | null> =
      kind === "project" || kind === "remove-project"
        ? [
            ...(removed ? [] : [projectContextTrigger.current]),
            projectMenuRef.current?.querySelector<HTMLElement>(
              '[aria-label="Filter projects"]',
            ) ?? null,
          ]
        : kind === "section" || kind === "new-section"
          ? [sectionContextTrigger.current, viewTrigger.current]
          : removed
            ? [newSessionTrigger.current]
            : [contextTrigger.current, newSessionTrigger.current];
    window.requestAnimationFrame(() => {
      [opener, ...fallbacks].find(
        (candidate) =>
          candidate?.isConnected && candidate.getClientRects().length > 0,
      )?.focus();
    });
  };
  const submitDialog = async () => {
    if (!dialog || mutation.busy) return;
    const value = dialog.value.trim();
    if (
      (dialog.kind === "section" ||
        dialog.kind === "new-section" ||
        dialog.kind === "project" ||
        dialog.kind === "session") &&
      !value
    )
      return;
    const deleteIDs =
      dialog.kind === "remove-project"
        ? dialog.sessionIDs ?? []
        : dialog.kind === "delete-session"
          ? [dialog.target]
          : null;
    if (deleteIDs) {
      const rejection = onBeforeDelete(deleteIDs);
      if (rejection) {
        setMutation({ busy: false, error: rejection });
        return;
      }
    }
    const completedDialog = dialog;
    setMutation({ busy: true, error: "" });
    try {
      if (dialog.kind === "new-section") {
        sections([...preferences.sidebar_sections,{id:crypto.randomUUID(),name:value.slice(0,120),collapsed:false}]);
      } else if (dialog.kind === "section") {
        sections(
          preferences.sidebar_sections.map((section) =>
            section.id === dialog.target
              ? { ...section, name: value }
              : section,
          ),
        );
      } else if (dialog.kind === "project") {
        await renameProject(dialog.target, value);
      } else if (dialog.kind === "remove-project") {
        const result = await removeProject(
          dialog.target,
          dialog.sessionIDs ?? [],
        );
        if (result?.cleanup_warning) setNotice(result.cleanup_warning);
        for (const id of dialog.sessionIDs ?? []) onDeleted(id);
      } else if (dialog.kind === "session") {
        await renameSession(dialog.target, value);
      } else {
        const result = await deleteSession(dialog.target);
        if (result?.cleanup_warning) setNotice(result.cleanup_warning);
        onDeleted(dialog.target);
      }
      setDialog(null);
      setMutation({ busy: false, error: "" });
      try {
        await refreshEngine();
      } catch {
        setNotice(
          "Changes were saved, but the sidebar could not refresh. Reopen the app to reload local state.",
        );
      }
      restoreDialogFocus(
        completedDialog,
        completedDialog.kind === "remove-project" ||
          completedDialog.kind === "delete-session",
      );
    } catch (reason) {
      setMutation({
        busy: false,
        error:
          reason instanceof Error
            ? reason.message
            : "Could not save this change.",
      });
    }
  };
  const openCopy = () => {
    chatMenuFocus.current = "back";
    setCopyOpen(true);
  };
  const returnToChatActions = () => {
    chatMenuFocus.current = "copy";
    setCopyOpen(false);
  };
  return (
    <aside
      hidden={page === "settings"}
      className={`sidebar ${preferences.sidebar_compact ? "compact-sidebar" : ""} ${preferences.sidebar_show_project_icon ? "show-project-icons" : ""} ${preferences.sidebar_show_project_label ? "" : "hide-project-labels"}`}
    >
      <div className="workspace-switcher">
        <span>OpenADE</span>
        <button
          className="icon-button workspace-action"
          aria-label="Search commands and chats"
          title="Search commands and chats"
          onClick={onSearch}
        >
          <ListMagnifyingGlass />
        </button>
        <button
          ref={newSessionTrigger}
          className="icon-button workspace-action"
          onClick={onNewSession}
          aria-label="New session"
          title="New session"
        >
          <Plus />
        </button>
        <button
          className="icon-button workspace-action"
          onClick={onToggle}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <SidebarSimple />
        </button>
      </div>
      {notice && (
        <button
          className="sidebar-mutation-notice"
          role="status"
          onClick={() => setNotice("")}
        >
          {notice}
        </button>
      )}
      <nav className="primary-nav" aria-label="Primary">
        <NavButton
          icon={<House />}
          label="Home"
          active={page === "home"}
          onClick={() => onPage("home")}
        />
        <NavButton
          icon={<SquaresFour />}
          label="Sites"
          active={page === "sites"}
          onClick={() => onPage("sites")}
        />
        <NavButton
          icon={<ListMagnifyingGlass />}
          label="Sessions"
          active={page === "sessions"}
          onClick={() => onPage("sessions")}
        />
        <NavButton
          icon={<Robot />}
          label="Workflows"
          active={page === "agents"}
          onClick={() => onPage("agents")}
        />
        <NavButton
          icon={<GitBranch />}
          label="Review"
          active={page === "review"}
          onClick={() => onPage("review")}
        />
      </nav>

      <div
        className="sidebar-scroll"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("text/openade-session-id") &&
              !event.dataTransfer.types.includes("text/openade-section")) return;
          const scroller = event.currentTarget;
          const bounds = scroller.getBoundingClientRect();
          if (event.clientY < bounds.top + 36) scroller.scrollTop -= 24;
          else if (event.clientY > bounds.bottom - 36) scroller.scrollTop += 24;
        }}
      >
        {preferences.pinned_sessions.some((id) =>
          filteredSidebarSessions.some((s) => s.id === id),
        ) && (
          <section className="project-group custom-sidebar-section">
            <div className="sidebar-section-title">Pinned</div>
            <div
              className="project-sessions"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = event.dataTransfer.getData(
                  "text/openade-session-id",
                );
                if (id && allSessions.some((session) => session.id === id)) {
                  const memberships = { ...preferences.session_sections };
                  delete memberships[id];
                  onPreferences({
                    ...preferences,
                    session_sections: memberships,
                    pinned_sessions: [
                      ...new Set([...preferences.pinned_sessions, id]),
                    ],
                  });
                }
              }}
            >
              {preferences.pinned_sessions
                .map((id) => filteredSidebarSessions.find((s) => s.id === id))
                .filter((s): s is Session => Boolean(s))
                .map(sessionButton)}
            </div>
          </section>
        )}
        {preferences.sidebar_sections.map((section, index) => (
          <section
            key={section.id}
            className="project-group custom-sidebar-section"
            draggable
            onDragStart={(event) =>
              event.dataTransfer.setData("text/openade-section", section.id)
            }
            onDragOver={(event) => event.preventDefault()}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextAnchor(event.clientX,event.clientY);
              setSectionMenu(section.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sessionID=event.dataTransfer.getData("text/openade-session-id");
              if(sessionID&&allSessions.some(value=>value.id===sessionID)){setMembership(sessionID,section.id);return;}
              const from = event.dataTransfer.getData("text/openade-section");
              if (from && from !== section.id && preferences.sidebar_sections.some(value=>value.id===from)) {
                const rows = [...preferences.sidebar_sections];
                const source = rows.findIndex((value) => value.id === from);
                rows.splice(source, 1);
                rows.splice(index, 0, {
                  ...preferences.sidebar_sections[source],
                });
                sections(rows);
              }
            }}
          >
            <div className="sidebar-section-title">
              <button
                className="section-collapse"
                aria-label={`${section.collapsed ? "Expand" : "Collapse"} ${section.name}`}
                aria-expanded={!section.collapsed}
                onClick={() =>
                  sections(
                    preferences.sidebar_sections.map((value) =>
                      value.id === section.id
                        ? { ...value, collapsed: !value.collapsed }
                        : value,
                    ),
                  )
                }
                onKeyDown={(event) => {
                  if (
                    !event.altKey || event.shiftKey ||
                    !["ArrowUp", "ArrowDown"].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const rows = [...preferences.sidebar_sections];
                  const current = rows.findIndex(
                    (value) => value.id === section.id,
                  );
                  const next = Math.max(
                    0,
                    Math.min(
                      rows.length - 1,
                      current + (event.key === "ArrowUp" ? -1 : 1),
                    ),
                  );
                  if (next !== current) {
                    rows.splice(current, 1);
                    rows.splice(next, 0, section);
                    sections(rows);
                  }
                }}
              >
                <CaretDown className={section.collapsed ? "" : "open"} />
                {section.name}
              </button>
              <button
                aria-label={`Section actions for ${section.name}`}
                onClick={(event) => {
                  sectionContextTrigger.current = event.currentTarget;
                  const rect=event.currentTarget.getBoundingClientRect();setContextAnchor(rect.left,rect.bottom+4);
                  setSectionMenu(section.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  sectionContextTrigger.current = event.currentTarget;
                  setContextAnchor(event.clientX,event.clientY);
                  setSectionMenu(section.id);
                }}
              >
                <DotsThree />
              </button>
            </div>
            {!section.collapsed && (
              <div
                className="project-sessions"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const id = event.dataTransfer.getData(
                    "text/openade-session-id",
                  );
                  if (id && allSessions.some((session) => session.id === id))
                    setMembership(id, section.id);
                }}
              >
                {filteredSidebarSessions
                  .filter(
                    (s) =>
                      preferences.session_sections[s.id] === section.id &&
                      !preferences.pinned_sessions.includes(s.id),
                  )
                  .map((session) => (
                    <div
                      key={session.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          "text/openade-session-id",
                          session.id,
                        );
                        event.dataTransfer.setData(
                          "text/openade-session",
                          `session:${session.id}`,
                        );
                      }}
                    >
                      {sessionButton(session)}
                    </div>
                  ))}
              </div>
            )}
          </section>
        ))}

        <div className="projects-heading" ref={projectMenuRef}>
          <Select
            className="projects-toggle"
            aria-label="Filter projects"
            icon={<Folder />}
            searchable
            stickyValue=""
            popupWidth={224}
            associatedPopupSelector=".project-context-menu"
            searchPlaceholder="Search projects…"
            value={preferences.sidebar_project_filter}
            onChange={(event) => {
              onPreferences({
                ...preferences,
                sidebar_project_filter: event.target.value,
              });
              setShowAllProjects(false);
              setExpanded(new Set(grouped.map((group) => group.root)));
            }}
            onChoiceContextMenu={(root, event) => {
              if (!root) return;
              event.preventDefault();
              projectContextTrigger.current =
                event.currentTarget as HTMLElement;
              setContextAnchor(event.clientX,event.clientY);
              setProjectContext(root);
            }}
            footer={
              <button
                type="button"
                className="new-project-action"
                onClick={() => {
                  window.dispatchEvent(new Event("openade-dismiss-menus"));
                  onNewProject();
                }}
              >
                <Plus />
                New project…
              </button>
            }
          >
            <option value="">All projects</option>
            {grouped
              .filter((group) => Boolean(group.root))
              .map(({ root }) => (
                <option key={root} value={root}>
                  <span className="project-picker-choice">
                    <span>{label(root)}</span>
                    <small>@ Local</small>
                  </span>
                </option>
              ))}
          </Select>
          <div className="projects-actions">
            <button
              ref={viewTrigger}
              onClick={() => setProjectMenuOpen((value) => !value)}
              aria-label="Project display settings"
              aria-haspopup="menu"
              aria-expanded={projectMenuOpen}
              title="Organize projects"
            >
              <DotsThree />
            </button>
            <button
              onClick={onNewProject}
              aria-label="Add project"
              title="Add a workspace folder"
            >
              <Plus />
            </button>
          </div>
          {projectMenuOpen &&
            createPortal(
              <div
                className="project-menu-wrap"
                style={{ position: "fixed", ...viewBounds }}
              >
                <ProjectMenu
                  organization={projectOrganization}
                  sort={projectSort}
                  onOrganization={chooseOrganization}
                  onSort={chooseSort}
                  onDismiss={() => {
                    setProjectMenuOpen(false);
                    viewTrigger.current?.focus();
                  }}
                  preferences={preferences}
                  onPreferences={onPreferences}
                  filter={filter}
                  onFilter={setFilter}
          onCreate={() => { dialogOpener.current=viewTrigger.current;setDialog({kind:"new-section",target:"",value:""});setProjectMenuOpen(false); }}
                />
              </div>,
              projectMenuRef.current?.closest(".ade") ?? document.body,
            )}
        </div>

        {!projectsCollapsed && projectOrganization === "project" && (
          <div
            className="project-groups"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const id = event.dataTransfer.getData("text/openade-session-id");
              if (id && allSessions.some((session) => session.id === id))
                setMembership(id, "");
            }}
          >
            {visibleGroups.map(({ root, items }) => {
              const open = expanded.has(root);
              const visible = showAll.has(root) ? items : items.slice(0, 3);
              return (
                <section className="project-group" key={root}>
                  <button
                    className="project-row"
                    onClick={() => toggle(root)}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes("text/openade-session-id"))
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const id = event.dataTransfer.getData("text/openade-session-id");
                      if (id && allSessions.some((session) => session.id === id)) {
                        event.preventDefault();
                        event.stopPropagation();
                        setMembership(id, "");
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      projectContextTrigger.current = event.currentTarget;
                      setContextAnchor(event.clientX,event.clientY);
                      setProjectContext(root);
                    }}
                    title={root}
                    aria-expanded={open}
                  >
                    <Folder />
                    <span>{label(root)}</span>
                    <CaretDown className={open ? "open" : ""} />
                  </button>
                  {open && (
                    <div className="project-sessions">
                      {visible.map((item) =>
                        item.kind === "session" ? (
                          <div
                            className="sidebar-draggable-row"
                            key={itemKey(item)}
                            draggable={projectSort === "manual"}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                "text/openade-session",
                                itemKey(item),
                              );
                              event.dataTransfer.setData(
                                "text/openade-session-id",
                                item.session.id,
                              );
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              const from = event.dataTransfer.getData(
                                "text/openade-session",
                              );
                              if (
                                from &&
                                from !== itemKey(item) &&
                                allItems.some((x) => itemKey(x) === from)
                              )
                                move(from, itemKey(item));
                            }}
                          >
                            {sessionButton(item.session)}
                          </div>
                        ) : (
                          <ExternalConversationButton
                            conversation={item.conversation}
                            key={itemKey(item)}
                            busy={
                              resumingConversationId ===
                              `${item.conversation.provider}:${item.conversation.id}`
                            }
                            onOpen={onResumeExternal}
                          />
                        ),
                      )}
                      {items.length > 3 && (
                        <button
                          className="show-more"
                          onClick={() =>
                            setShowAll((current) => {
                              const next = new Set(current);
                              if (next.has(root)) next.delete(root);
                              else next.add(root);
                              return next;
                            })
                          }
                        >
                          {showAll.has(root)
                            ? "Show less"
                            : `Show ${items.length - 3} more`}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
            {filteredGroups.length > 10 && (
              <button
                className="all-projects-toggle"
                onClick={() => setShowAllProjects((value) => !value)}
              >
                {showAllProjects
                  ? "Show fewer projects"
                  : `Show ${filteredGroups.length - 10} more projects`}
              </button>
            )}
          </div>
        )}

        {!projectsCollapsed &&
          (projectOrganization === "list" ||
            projectOrganization === "device") && (
            <div className="project-flat-list project-sessions">
              {projectOrganization === "device" && (
                <div className="sidebar-section-title">Local</div>
              )}
              {visibleFlatItems.map((item) =>
                item.kind === "session" ? (
                  sessionButton(item.session)
                ) : (
                  <ExternalConversationButton
                    conversation={item.conversation}
                    key={itemKey(item)}
                    busy={
                      resumingConversationId ===
                      `${item.conversation.provider}:${item.conversation.id}`
                    }
                    onOpen={onResumeExternal}
                  />
                ),
              )}
              {filteredItems.length > 10 && (
                <button
                  className="all-projects-toggle"
                  onClick={() => setShowAllProjects((value) => !value)}
                >
                  {showAllProjects
                    ? "Show fewer chats"
                    : `Show ${filteredItems.length - 10} more chats`}
                </button>
              )}
              {filteredItems.length === 0 && (
                <div className="project-empty">
                  Chats from indexed projects will appear here.
                </div>
              )}
            </div>
          )}
        {archivedItems.length > 0 && (
          <section className="archived-disclosure">
            <button
              className="archived-toggle"
              aria-expanded={archivedOpen}
              aria-controls="archived-sessions"
              onClick={() => {
                setArchivedOpen((open) => !open);
                setArchivedShown(10);
              }}
            >
              <span>{archivedOpen ? "Archived" : `Archived (${archivedItems.length})`}</span>
              <CaretDown className={archivedOpen ? "open" : ""} />
            </button>
            {archivedOpen && (
              <div id="archived-sessions" className="archived-sessions project-sessions">
                {visibleArchivedItems.map((item) => (
                  <div className="archived-session-row" key={item.session.id}>
                    {sessionButton(item.session)}
                    <button
                      className="archived-restore"
                      aria-label={`Unarchive ${item.session.title}`}
                      title="Unarchive"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void onArchive(item.session.id, false);
                      }}
                    >
                      Unarchive
                    </button>
                  </div>
                ))}
                {archivedItems.length > archivedShown && (
                  <button
                    className="archived-more"
                    onClick={() => setArchivedShown((shown) => shown + 25)}
                  >
                    <Plus />
                    Show {Math.min(25, archivedItems.length - archivedShown)} more
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </div>
      <div className="sidebar-footer">
        <div className="profile">
          <span className="avatar">L</span>
          <span>
            <strong>Local</strong>
            <small className="connection-state">
              {connected ? "Daemon connected" : "Reconnecting…"}
            </small>
          </span>
        </div>
        <button
          className={`icon-button ${page === "settings" ? "active" : ""}`}
          onClick={() => onPage("settings")}
          aria-label="Open settings"
          title="Settings"
        >
          <Gear />
        </button>
      </div>
      {sectionMenu &&
        createPortal(
          <div
            className="sidebar-session-menu section-context-menu"
            style={{
              position: "fixed",
              left: Math.max(
                8,
                Math.min(contextPosition.left, window.innerWidth - 188),
              ),
              top: Math.max(
                8,
                Math.min(contextPosition.top, window.innerHeight - 130),
              ),
              bottom: "auto",
              width: 180,
            }}
            role="menu"
            aria-label="Section actions"
            onKeyDown={(event) =>
              menuKeys(
                event,
                () => setSectionMenu(null),
                () => sectionContextTrigger.current?.focus(),
              )
            }
          >
            <button
              role="menuitem"
              onClick={() => {
                dialogOpener.current = sectionContextTrigger.current;
                const section = preferences.sidebar_sections.find(
                  (value) => value.id === sectionMenu,
                );
                if (section)
                  setDialog({
                    kind: "section",
                    target: section.id,
                    value: section.name,
                  });
                setSectionMenu(null);
              }}
            >
              Edit section
            </button>
            <button
              role="menuitem"
              onClick={() => {
                archiveSection(sectionMenu);
                setSectionMenu(null);
              }}
            >
              Archive all
            </button>
            <button
              className="menu-danger"
              role="menuitem"
              onClick={() => {
                deleteSection(sectionMenu);
                setSectionMenu(null);
              }}
            >
              Delete
            </button>
          </div>,
          projectMenuRef.current?.closest(".ade") ?? document.body,
        )}
      {projectContext &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: contextPosition.left,
              top: contextPosition.top,
              bottom: "auto",
            }}
            className="sidebar-session-menu project-context-menu"
            role="menu"
            aria-label="Project actions"
            onKeyDown={(event) =>
              menuKeys(
                event,
                () => setProjectContext(null),
                () => projectContextTrigger.current?.focus(),
              )
            }
          >
            <button
              role="menuitem"
              onClick={() => {
                dialogOpener.current = projectContextTrigger.current;
                setDialog({
                  kind: "project",
                  target: projectContext,
                  value: label(projectContext),
                });
                setProjectContext(null);
              }}
            >
              <PencilSimple size={16}/>Rename…
            </button>
            <hr />
            <button
              className="menu-danger"
              role="menuitem"
              onClick={() => {
                openRemove(projectContext);
                setProjectContext(null);
              }}
            >
              <Trash size={16}/>Remove…
            </button>
          </div>,
          projectMenuRef.current?.closest(".ade") ?? document.body,
        )}
      {context &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: contextPosition.left,
              top: contextPosition.top,
              bottom: "auto",
            }}
            className="sidebar-session-menu"
            onKeyDown={(event) => {
              if (copyOpen && event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                returnToChatActions();
                return;
              }
              menuKeys(
                event,
                () => setContext(null),
                () => contextTrigger.current?.focus(),
              );
            }}
            role="menu"
            aria-label="Chat actions"
          >
            {copyOpen ? (
              <>
                <button data-copy-back role="menuitem" onClick={returnToChatActions}>
                  <ArrowLeft size={16}/>Back
                </button>
                <hr />
                {menuError && (
                  <p className="inline-error" role="alert">
                    {menuError}
                  </p>
                )}
                {context.repo_root && context.worktree_path && <button
                  role="menuitem"
                  onClick={() =>
                    void copyText(context.worktree_path)
                      .then(() => setContext(null))
                      .catch((reason) =>
                        setMenuError(
                          reason instanceof Error
                            ? reason.message
                            : "Clipboard unavailable",
                        ),
                      )
                  }
                >
                  <Copy size={16}/>Path
                </button>}
                {context.provider_session_id && <button
                  role="menuitem"
                  onClick={() =>
                    context.provider_session_id &&
                    void copyText(context.provider_session_id)
                      .then(() => setContext(null))
                      .catch((reason) =>
                        setMenuError(
                          reason instanceof Error
                            ? reason.message
                            : "Clipboard unavailable",
                        ),
                      )
                  }
                >
                  <Copy size={16}/>Harness session ID
                </button>}
              </>
            ) : (
              <>
                {menuError && (
                  <p className="inline-error" role="alert">
                    {menuError}
                  </p>
                )}
                <button
                  data-chat-menu-first
                  role="menuitem"
                  onClick={() => {
                    dialogOpener.current = contextTrigger.current;
                    setDialog({
                      kind: "session",
                      target: context.id,
                      value: context.title,
                    });
                    setContext(null);
                  }}
                >
                  <PencilSimple size={16}/>Rename…
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    onPreferences({
                      ...preferences,
                      pinned_sessions: preferences.pinned_sessions.includes(
                        context.id,
                      )
                        ? preferences.pinned_sessions.filter(
                            (x) => x !== context.id,
                          )
                        : [...preferences.pinned_sessions, context.id],
                      session_sections: preferences.pinned_sessions.includes(
                        context.id,
                      )
                        ? preferences.session_sections
                        : { ...preferences.session_sections, [context.id]: "" },
                    });
                    setContext(null);
                  }}
                >
                  <PushPin size={16}/>{preferences.pinned_sessions.includes(context.id) ? "Unpin" : "Pin"}
                </button>
                <button role="menuitem" onClick={() => archive(context.id)}>
                  <Archive size={16}/>{context.archived ? "Unarchive" : "Archive"}
                </button>
                <button
                  data-copy-trigger
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={copyOpen}
                  onClick={openCopy}
                >
                  <Copy size={16}/>Copy <CaretRight size={14}/>
                </button>
                <hr />
                <button
                  className="menu-danger"
                  role="menuitem"
                  onClick={() => {
                    dialogOpener.current = contextTrigger.current;
                    setDialog({
                      kind: "delete-session",
                      target: context.id,
                      value: context.title,
                    });
                    setContext(null);
                  }}
                >
                  <Trash size={16}/>Delete…
                </button>
              </>
            )}
          </div>,
          projectMenuRef.current?.closest(".ade") ?? document.body,
        )}
      {dialog &&
        createPortal(
          <div className="sidebar-dialog-backdrop" role="presentation">
            <form
              ref={dialogRef}
              className={`sidebar-dialog ${
                dialog.kind === "remove-project" ||
                dialog.kind === "delete-session"
                  ? "danger-dialog"
                  : ""
              }`}
              role="dialog"
              aria-modal="true"
              aria-label={
                dialog.kind === "remove-project"
                  ? "Remove project"
                  : dialog.kind === "delete-session"
                    ? "Delete chat"
                    : dialog.kind === "section"
                      ? "Edit section"
                      : dialog.kind === "new-section" ? "New section"
                      : dialog.kind === "project"
                        ? "Rename project"
                        : "Rename"
              }
              onSubmit={(event) => {
                event.preventDefault();
                void submitDialog();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (!mutation.busy) {
                    setDialog(null);
                    restoreDialogFocus(dialog);
                  }
                  return;
                }
                if (event.key === "Tab") {
                  const controls = [
                    ...event.currentTarget.querySelectorAll<HTMLElement>(
                      "input,button:not(:disabled)",
                    ),
                  ];
                  const current = controls.indexOf(
                    document.activeElement as HTMLElement,
                  );
                  if (controls.length) {
                    event.preventDefault();
                    controls[
                      (current + (event.shiftKey ? -1 : 1) + controls.length) %
                        controls.length
                    ]?.focus();
                  }
                }
              }}
            >
              <div className="sidebar-dialog-title"><h2>
                {dialog.kind === "remove-project"
                  ? "Remove project?"
                  : dialog.kind === "delete-session"
                    ? "Delete chat?"
                    : dialog.kind === "section"
                      ? "Edit section"
                      : dialog.kind === "new-section" ? "New section"
                      : dialog.kind === "project"
                        ? "Rename project"
                        : "Rename"}
              </h2><button type="button" disabled={mutation.busy} aria-label="Close dialog" onClick={()=>{if(mutation.busy)return;setDialog(null);restoreDialogFocus(dialog);}}><X size={16}/></button></div>
              {dialog.kind === "remove-project" ? (
                <p>
                  This permanently removes {dialog.sessionIDs?.length ?? 0}{" "}
                  local OpenADE chats on this device. Your repository and
                  worktree files stay on disk.
                </p>
              ) : dialog.kind === "delete-session" ? (
                <p>
                  This permanently deletes this local OpenADE chat and its
                  transcript.
                </p>
              ) : (
                <>{(dialog.kind==="new-section"||dialog.kind==="section")&&<p className="sidebar-dialog-helper">Group sessions however you like</p>}
                <input
                  autoFocus
                  aria-label="Name"
                  placeholder={
                    dialog.kind === "new-section" || dialog.kind === "section"
                      ? "Section name"
                      : undefined
                  }
                  maxLength={
                    dialog.kind === "section" || dialog.kind === "project" || dialog.kind === "new-section"
                      ? 120
                      : 240
                  }
                  value={dialog.value}
                  onChange={(event) =>
                    setDialog({ ...dialog, value: event.target.value })
                  }
                />
                </>
              )}
              {mutation.error && (
                <p className="inline-error" role="alert">
                  {mutation.error}
                </p>
              )}
              <div>
                <button
                  type="button"
                  disabled={mutation.busy}
                  onClick={() => {
                    setDialog(null);
                    setMutation({ busy: false, error: "" });
                    restoreDialogFocus(dialog);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" disabled={mutation.busy||(dialog.kind==="new-section"&&!dialog.value.trim())}>
                  {dialog.kind === "remove-project" ||
                  dialog.kind === "delete-session"
                    ? dialog.kind === "remove-project"
                      ? "Remove"
                      : "Delete"
                    : dialog.kind === "new-section" ? "Create section" : dialog.kind === "project"
                      ? "Rename"
                      : "Save"}
                </button>
              </div>
            </form>
          </div>,
          projectMenuRef.current?.closest(".ade") ?? document.body,
        )}
    </aside>
  );
}

function ProjectMenu({
  onDismiss,
  organization,
  sort,
  onOrganization,
  onSort,
  preferences,
  onPreferences,
  filter,
  onFilter,
  onCreate,
}: {
  onDismiss: () => void;
  organization: ProjectOrganization;
  sort: ProjectSort;
  onOrganization: (value: ProjectOrganization) => void;
  onSort: (value: ProjectSort) => void;
  preferences: Preferences;
  onPreferences: (next: Preferences) => void;
  filter: string;
  onFilter: (value: string) => void;
  onCreate: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null),
    showTrigger = useRef<HTMLButtonElement>(null);
  const [submenu, setSubmenu] = useState<"organize" | "sort" | "show" | null>(
    null,
  );
  const [keyboard, setKeyboard] = useState(false);
  const active = useRef<typeof submenu>(null),
    origin = useRef<{ x: number; y: number } | null>(null),
    last = useRef<{ x: number; y: number } | null>(null),
    pending = useRef<{
      key: typeof submenu;
      timer: ReturnType<typeof setTimeout>;
    } | null>(null);
  active.current = submenu;
  const cancel = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  };
  const openChild = (key: typeof submenu, focus: boolean) => {
    cancel();
    setKeyboard(focus);
    setSubmenu(key);
  };
  const childBounds = () =>
    menu.current
      ?.closest(".ade")
      ?.querySelector<HTMLElement>(".sidebar-choice-submenu,.sidebar-show-menu")
      ?.getBoundingClientRect();
  const corridor = (x: number, y: number) => {
    const bounds = childBounds(),
      start = origin.current;
    if (!bounds || !start) return false;
    const left = bounds.right <= menu.current!.getBoundingClientRect().left,
      edge = left ? bounds.right : bounds.left,
      direction = left ? -1 : 1,
      distance = (edge - start.x) * direction,
      advance = (x - start.x) * direction;
    if (distance <= 0 || advance <= 0 || advance > distance + 8) return false;
    const fraction = Math.min(1, advance / distance);
    return (
      y >= start.y + (bounds.top - 8 - start.y) * fraction &&
      y <= start.y + (bounds.bottom + 8 - start.y) * fraction
    );
  };
  const hover = (
    key: typeof submenu,
    event: { clientX: number; clientY: number },
  ) => {
    if (active.current === key) {
      cancel();
      origin.current = { x: event.clientX, y: event.clientY };
      last.current = origin.current;
      return;
    }
    const bounds = childBounds(),
      left = Boolean(
        bounds && bounds.right <= menu.current!.getBoundingClientRect().left,
      ),
      forward = last.current
        ? (event.clientX - last.current.x) * (left ? -1 : 1)
        : 0;
    if (
      active.current &&
      corridor(event.clientX, event.clientY) &&
      forward > -2
    ) {
      if (pending.current?.key !== key || forward >= 2) {
        cancel();
        const source = active.current;
        pending.current = {
          key,
          timer: setTimeout(() => {
            if (active.current === source && pending.current?.key === key)
              openChild(key, false);
          }, 300),
        };
      }
      last.current = { x: event.clientX, y: event.clientY };
    } else {
      openChild(key, false);
      origin.current = { x: event.clientX, y: event.clientY };
      last.current = origin.current;
    }
  };
  useEffect(() => () => cancel(), []);
  useEffect(() => {
    if (submenu === "show" && keyboard)
      document.querySelector<HTMLElement>(".sidebar-show-menu button")?.focus();
  }, [submenu, keyboard]);
  useEffect(() => {
    if (!submenu) return;
    const move = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest(".sidebar-choice-submenu,.sidebar-show-menu")) {
        cancel();
        return;
      }
      const parent = menu.current?.getBoundingClientRect();
      if (
        parent &&
        event.clientX >= parent.left &&
        event.clientX <= parent.right &&
        event.clientY >= parent.top &&
        event.clientY <= parent.bottom
      )
        return;
      if (!corridor(event.clientX, event.clientY)) openChild(null, false);
    };
    document.addEventListener("pointermove", move);
    return () => document.removeEventListener("pointermove", move);
  }, [submenu]);
  const flags = [
    ["sidebar_show_branch", "Branch"],
    ["sidebar_show_pr", "Pull request"],
    ["sidebar_show_provider", "Provider"],
    ["sidebar_show_project_icon", "Project icon"],
    ["sidebar_show_project_label", "Project label"],
  ] as const;
  const rect = showTrigger.current?.getBoundingClientRect();
  const showLeft = rect && rect.right + 216 > window.innerWidth;
  const row = (
    key: "organize" | "sort",
    label: string,
    choices: ReactNode,
    value: string,
    change: (value: string) => void,
  ) => (
    <div
      className="sidebar-menu-row"
      onPointerEnter={(event) => hover(key, event)}
      onPointerMove={(event) => hover(key, event)}
      onPointerLeave={() => {
        if (pending.current?.key === key) cancel();
      }}
      onClick={(event) => {
        if (!(event.target as Element).closest(".select-popover"))
          openChild(key, true);
      }}
    >
      <span>{label}</span>
      <Select
        placement="right"
        popupClassName="sidebar-choice-submenu"
        expanded={submenu === key}
        focusOnOpen={keyboard}
        onExpandedChange={(value) => openChild(value ? key : null, true)}
        aria-label={key === "organize" ? "Organize sidebar" : "Sort chats"}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        {choices}
      </Select>
    </div>
  );
  return (
    <div
      ref={menu}
      className="project-menu sidebar-view-menu"
      onKeyDown={(event) => menuKeys(event, onDismiss)}
      role="menu"
      aria-label="Project display settings"
    >
      {row(
        "organize",
        "Organize",
        <>
          <option value="device">By device</option>
          <option value="project">By project</option>
          <option value="list">None</option>
        </>,
        organization,
        (value) => onOrganization(value as ProjectOrganization),
      )}
      {row(
        "sort",
        "Sort",
        <>
          <option value="updated">Last updated</option>
          <option value="created">Created</option>
          <option value="priority">Priority</option>
          <option value="manual">Manual order</option>
        </>,
        sort,
        (value) => onSort(value as ProjectSort),
      )}
      <button
        ref={showTrigger}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={submenu === "show"}
        onPointerEnter={(event) => hover("show", event)}
        onPointerMove={(event) => hover("show", event)}
        onClick={() => openChild("show", true)}
      >
        Show
        <CaretDown />
      </button>
      <button
        role="menuitemcheckbox"
        aria-checked={preferences.sidebar_compact}
        onPointerEnter={(event) => hover(null, event)}
        onClick={() => {
          openChild(null, false);
          onPreferences({
            ...preferences,
            sidebar_compact: !preferences.sidebar_compact,
          });
        }}
      >
        <span>Compact</span>
        <span
          className={`sidebar-compact-switch ${preferences.sidebar_compact ? "on" : ""}`}
        >
          <i />
        </span>
      </button>
      <button
        role="menuitem"
        onPointerEnter={(event) => hover(null, event)}
        onClick={() => {
          openChild(null, false);
          onCreate();
        }}
      >
        <Plus />
        Create Section
      </button>
      {submenu === "show" &&
        rect &&
        createPortal(
          <div
            className="sidebar-show-menu select-popover"
            style={{
              position: "fixed",
              left: showLeft ? Math.max(8, rect.left - 216) : rect.right + 6,
              top: Math.max(8, Math.min(rect.top, window.innerHeight - 222)),
              width: 210,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                openChild(null, true);
                showTrigger.current?.focus();
              } else
                menuKeys(
                  event,
                  () => openChild(null, true),
                  () => showTrigger.current?.focus(),
                );
            }}
            role="menu"
            aria-label="Show sidebar details"
          >
            {flags.map(([key, label]) => (
              <button
                key={key}
                role="menuitemcheckbox"
                aria-checked={preferences[key]}
                onClick={() =>
                  onPreferences({ ...preferences, [key]: !preferences[key] })
                }
              >
                <span>{label}</span>
                {preferences[key] && <Check />}
              </button>
            ))}
            <input
              aria-label="Filter sidebar sessions"
              placeholder="Filter chats…"
              value={filter}
              onChange={(event) => onFilter(event.target.value)}
            />
          </div>,
          showTrigger.current?.closest(".ade") ?? document.body,
        )}
    </div>
  );
}

function ExternalConversationButton({
  conversation,
  busy,
  onOpen,
}: {
  conversation: ExternalConversation;
  busy: boolean;
  onOpen: (conversation: ExternalConversation) => void;
}) {
  return (
    <button
      className="external-session"
      onClick={() => onOpen(conversation)}
      disabled={busy}
      title={`Resume this ${providerLabel(conversation.provider)} conversation`}
    >
      <ProviderIcon provider={conversation.provider} />{" "}
      <span>{conversation.title}</span>
      <small>{relativeTime(conversation.updated_at)}</small>
      {busy && <SpinnerGap className="spin" />}
    </button>
  );
}

function sortSidebarItems(
  items: SidebarItem[],
  sort: ProjectSort,
): SidebarItem[] {
  if (sort === "manual") return [...items];
  return [...items].sort((left, right) =>
    compareSidebarItems(left, right, sort),
  );
}

function compareSidebarItems(
  left: SidebarItem,
  right: SidebarItem,
  sort: ProjectSort,
): number {
  if (sort === "priority") {
    const priority = itemPriority(left) - itemPriority(right);
    if (priority) return priority;
  }
  if (sort === "created")
    return (
      timestamp(
        right.kind === "session" ? right.session.created_at : right.updatedAt,
      ) -
      timestamp(
        left.kind === "session" ? left.session.created_at : left.updatedAt,
      )
    );
  return timestamp(right.updatedAt) - timestamp(left.updatedAt);
}

function itemPriority(item: SidebarItem): number {
  if (item.kind === "external") return 2;
  return ["starting", "running", "waiting"].includes(item.session.status)
    ? 0
    : 1;
}

function itemRoot(item: SidebarItem): string {
  return item.kind === "session"
    ? item.session.repo_root
    : item.conversation.project_root;
}

function itemKey(item: SidebarItem): string {
  return item.kind === "session"
    ? `session:${item.session.id}`
    : `external:${item.conversation.provider}:${item.conversation.id}`;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function providerLabel(provider: ExternalConversation["provider"]): string {
  return provider === "claude" ? "Claude" : "Codex";
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={active ? "active" : ""}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
