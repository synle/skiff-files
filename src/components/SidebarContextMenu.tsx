// Right-click context menu for sidebar rows. Different sections (Favorites
// / Bookmarks / Recent) get different action sets — the menu is purely
// presentational; the parent (Sidebar) supplies the actions per-row.
//
// Keeping per-section actions out of this component means we don't have
// to teach the menu about "is this a bookmark?" — Sidebar already knows.
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider } from "@mui/material";
import type { ReactNode } from "react";

export interface SidebarContextAction {
  /** Stable id used as the React key. */
  key: string;
  /** Optional left-icon. Tiny so the menu reads quickly. */
  icon?: ReactNode;
  label: string;
  /** When true, the menu item renders disabled (per-action gating). */
  disabled?: boolean;
  /** Insert a divider AFTER this item. Used to group destructive
   *  actions (remove / hide) below the rest. */
  dividerAfter?: boolean;
  onClick: () => void;
}

export interface SidebarContextState {
  /** Anchor coordinates from the right-click event. */
  x: number;
  y: number;
  /** Section the right-click landed in — "favorites" / "bookmarks" /
   *  "recent". The menu doesn't read it, but parents use it to decide
   *  the action list. */
  section: "favorites" | "bookmarks" | "recent" | "hosts";
  /** Stable identifier for the sub-row (bookmark id, recent path,
   *  favorite rel, host id). Parents use this to look up the actions. */
  itemId: string;
  /** Pre-resolved actions to render. Empty means the menu won't open. */
  actions: SidebarContextAction[];
}

interface Props {
  state: SidebarContextState | null;
  onClose: () => void;
}

export default function SidebarContextMenu({ state, onClose }: Props) {
  const open = state != null && state.actions.length > 0;
  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        state ? { top: state.y, left: state.x } : undefined
      }
      slotProps={{ list: { dense: true } }}
    >
      {state?.actions.map((a) => [
        <MenuItem
          key={a.key}
          disabled={a.disabled}
          onClick={() => {
            // Close BEFORE firing — actions like rename can pop their
            // own modal, which would render under the menu's backdrop
            // if we close last.
            onClose();
            a.onClick();
          }}
        >
          {a.icon && <ListItemIcon>{a.icon}</ListItemIcon>}
          <ListItemText>{a.label}</ListItemText>
        </MenuItem>,
        a.dividerAfter ? <Divider key={`${a.key}-divider`} /> : null,
      ])}
    </Menu>
  );
}
