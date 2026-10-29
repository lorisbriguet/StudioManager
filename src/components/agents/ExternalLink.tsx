import type { AnchorHTMLAttributes, MouseEvent } from "react";
import type { ExtraProps } from "react-markdown";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useT } from "../../i18n/useT";
import { notify } from "../../lib/notify";

/** What the shell plugin's default `open` scope accepts; anything else is not opened. */
export function isExternalUrl(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

/**
 * The `a` of text the app does not control (agent replies). The link never
 * navigates the webview: http(s) and mailto go to the system browser or mail
 * app, every other href (relative, file:, custom schemes) does nothing.
 * src-tauri's navigation guard backs this up for anything that slips past.
 */
export function ExternalLink({ href, children, node: _node, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  const t = useT();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!href || !isExternalUrl(href)) return;
    openUrl(href.trim()).catch((err) => notify.error(t.failed_to_open_url, err));
  };
  return (
    <a
      {...rest}
      href={href}
      rel="noreferrer"
      onClick={onClick}
      // A middle click would ask the webview for a new window.
      onAuxClick={(e) => e.preventDefault()}
    >
      {children}
    </a>
  );
}
